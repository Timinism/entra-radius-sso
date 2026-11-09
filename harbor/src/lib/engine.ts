import { randomBytes, randomUUID } from "node:crypto";

import { decideAccess, serviceFor } from "./policy";
import {
  accountingAuthenticatorValid,
  buildResponse,
  codeName,
  decodePacket,
  describeAttributes,
  hasGlobalProtectHint,
  messageAuthenticatorStatus,
  nasIpOf,
  revealPassword,
  usernameOf,
  utf8Attr,
  type WireAttr,
} from "./radius";
import { verifyPassword } from "./seed";
import { readState, withState } from "./store";
import type { AdminService, Approval, AuthEvent, AuthResult, Database, Device, DisplayAttr, Stage } from "./types";
import { usernamesMatch } from "./username";

export type HandleResult =
  | { kind: "drop"; reason: string }
  | { kind: "reply"; packet: Buffer; result: AuthResult; approvalId: string | null }
  | { kind: "pending"; approval: Approval };

const BREAKGLASS_UPN = "breakglass@northline.example";

function loopback(ip: string): boolean {
  return ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
}

function deviceFor(devices: Device[], sourceIp: string, attributes: WireAttr[]): Device | null {
  const enabled = devices.filter((device) => device.enabled);
  const direct = enabled.find((device) => device.nasIp === sourceIp);
  if (direct) return direct;
  if (!loopback(sourceIp)) return null;
  const nasIp = nasIpOf(attributes);
  if (!nasIp) return null;
  return enabled.find((device) => device.nasIp === nasIp) ?? null;
}

function shortReject(message: string): WireAttr[] {
  return [utf8Attr(18, message)];
}

export async function handlePacket(
  stage: Stage,
  packet: Buffer,
  sourceIp: string,
  via: "radius" | "bench",
): Promise<HandleResult> {
  const decoded = decodePacket(packet);
  if ("error" in decoded) return { kind: "drop", reason: decoded.error };
  return withState(stage, (db) => {
    const device = deviceFor(db.devices, sourceIp, decoded.attributes);
    if (!device) return { kind: "drop" as const, reason: "No device is registered for this source address." };

    const authenticatorStatus = messageAuthenticatorStatus(packet, device.sharedSecret);
    if (authenticatorStatus === "invalid") {
      return { kind: "drop" as const, reason: "Message-Authenticator does not match the shared secret." };
    }
    if (decoded.code === 4) {
      if (!accountingAuthenticatorValid(packet, device.sharedSecret)) {
        return { kind: "drop" as const, reason: "Accounting authenticator does not match the shared secret." };
      }
      device.lastSeenAt = new Date().toISOString();
      const username = usernameOf(decoded.attributes) || "(accounting)";
      const event: AuthEvent = {
        id: randomUUID(),
        at: device.lastSeenAt,
        username,
        deviceId: device.id,
        deviceName: device.name,
        vendor: device.vendor,
        service: "accounting",
        result: "accounted",
        reason: "Accounting-Request accepted.",
        method: "none",
        latencyMs: 0,
        attributes: describeAttributes(decoded.attributes).filter((attr) => attr.name !== "User-Password"),
        source: via,
      };
      db.events.unshift(event);
      const reply = buildResponse({
        code: 5,
        identifier: decoded.identifier,
        requestAuthenticator: decoded.authenticator,
        secret: device.sharedSecret,
        attributes: [],
        messageAuthenticator: authenticatorStatus === "valid",
      });
      return {
        kind: "reply" as const,
        packet: reply,
        approvalId: null,
        result: {
          code: "accept" as const,
          reason: event.reason,
          replyMessage: "",
          policyName: null,
          method: "none" as const,
          attributes: [],
        },
      };
    }

    if (decoded.code !== 1) {
      return { kind: "drop" as const, reason: `${codeName(decoded.code)} is not an access request.` };
    }
    if (db.settings.requireMessageAuthenticator && authenticatorStatus !== "valid") {
      return signedReject(db, device, decoded, sourceIp, via, false, "Harbor requires Message-Authenticator.", "Message-Authenticator was missing.");
    }

    const username = usernameOf(decoded.attributes);
    if (!username || username.length > 120) {
      return signedReject(db, device, decoded, sourceIp, via, authenticatorStatus === "valid", "Denied by Harbor.", "The request did not include a username.");
    }

    const service = serviceFor(device, hasGlobalProtectHint(decoded.attributes));
    if (typeof service !== "string") {
      return signedReject(db, device, decoded, sourceIp, via, authenticatorStatus === "valid", "Denied by Harbor.", service.error);
    }

    if (via === "radius") {
      const existing = db.approvals.find(
        (approval) =>
          approval.status === "pending" &&
          approval.source === "radius" &&
          approval.deviceId === device.id &&
          approval.username === username &&
          approval.radiusIdentifier === decoded.identifier,
      );
      if (existing) return { kind: "pending" as const, approval: existing };
    }

    const passwordAttr = decoded.attributes.find((attr) => attr.type === 2 && attr.vendorId === undefined);
    const password = passwordAttr
      ? revealPassword(passwordAttr.value, device.sharedSecret, decoded.authenticator)
      : "";
    const emergency = db.users.find((user) => user.emergency);
    if (
      db.settings.breakglassEnabled &&
      emergency &&
      usernamesMatch(username, emergency.upn) &&
      password &&
      verifyPassword(password, emergency.passwordHash)
    ) {
      return finishNow(db, {
        device,
        username,
        service,
        sourceIp,
        via,
        decodedIdentifier: decoded.identifier,
        requestAuthenticator: decoded.authenticator,
        includeMessageAuthenticator: authenticatorStatus === "valid",
        requestAttributes: describeAttributes(decoded.attributes),
        groups: emergency.groups,
        method: "break-glass",
        signedInUpn: emergency.upn,
        status: "approved",
      });
    }
    if (emergency && usernamesMatch(username, emergency.upn)) {
      return signedReject(
        db,
        device,
        decoded,
        sourceIp,
        via,
        authenticatorStatus === "valid",
        "Denied by Harbor.",
        "Break-glass password was not accepted.",
        username,
        service,
      );
    }

    const now = new Date();
    const approval: Approval = {
      id: randomUUID(),
      username,
      deviceId: device.id,
      deviceName: device.name,
      vendor: device.vendor,
      os: device.os,
      service,
      status: "pending",
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + db.settings.timeoutSeconds * 1000).toISOString(),
      resolvedAt: null,
      signedInUpn: null,
      groups: [],
      method: null,
      groupSource: null,
      denyReason: null,
      radiusIdentifier: decoded.identifier,
      source: via,
      sourceIp,
      requestAttributes: describeAttributes(decoded.attributes),
      requestAuthenticatorHex: decoded.authenticator.toString("hex"),
      includeMessageAuthenticator: authenticatorStatus === "valid",
      responsePacketHex: null,
      result: null,
    };
    device.lastSeenAt = approval.createdAt;
    db.approvals.unshift(approval);
    return { kind: "pending" as const, approval };
  });
}

function signedReject(
  db: Database,
  device: Device,
  decoded: { identifier: number; authenticator: Buffer; attributes: WireAttr[] },
  sourceIp: string,
  via: "radius" | "bench",
  includeMessageAuthenticator: boolean,
  replyMessage: string,
  reason: string,
  username = usernameOf(decoded.attributes) || "(none)",
  service: AdminService = "device-admin",
): HandleResult {
  const result: AuthResult = {
    code: "reject",
    reason,
    replyMessage,
    policyName: null,
    method: "none",
    attributes: describeAttributes(shortReject(replyMessage)),
  };
  const packet = buildResponse({
    code: 3,
    identifier: decoded.identifier,
    requestAuthenticator: decoded.authenticator,
    secret: device.sharedSecret,
    attributes: shortReject(replyMessage),
    messageAuthenticator: includeMessageAuthenticator,
  });
  device.lastSeenAt = new Date().toISOString();
  db.events.unshift({
    id: randomUUID(),
    at: device.lastSeenAt,
    username,
    deviceId: device.id,
    deviceName: device.name,
    vendor: device.vendor,
    service,
    result: "reject",
    reason,
    method: "none",
    latencyMs: 0,
    attributes: result.attributes,
    source: via,
  });
  return { kind: "reply", packet, result, approvalId: null };
}

function finishNow(
  db: Database,
  input: {
    device: Device;
    username: string;
    service: AdminService;
    sourceIp: string;
    via: "radius" | "bench";
    decodedIdentifier: number;
    requestAuthenticator: Buffer;
    includeMessageAuthenticator: boolean;
    requestAttributes: DisplayAttr[];
    groups: string[];
    method: "break-glass";
    signedInUpn: string;
    status: "approved";
  },
): HandleResult {
  const now = new Date().toISOString();
  const approval: Approval = {
    id: randomUUID(),
    username: input.username,
    deviceId: input.device.id,
    deviceName: input.device.name,
    vendor: input.device.vendor,
    os: input.device.os,
    service: input.service,
    status: "approved",
    createdAt: now,
    expiresAt: now,
    resolvedAt: now,
    signedInUpn: input.signedInUpn,
    groups: input.groups,
    method: input.method,
    groupSource: "sample",
    denyReason: null,
    radiusIdentifier: input.decodedIdentifier,
    source: input.via,
    sourceIp: input.sourceIp,
    requestAttributes: input.requestAttributes,
    requestAuthenticatorHex: input.requestAuthenticator.toString("hex"),
    includeMessageAuthenticator: input.includeMessageAuthenticator,
    responsePacketHex: null,
    result: null,
  };
  db.approvals.unshift(approval);
  const settled = settleInPlace(db, approval.id);
  if (!settled || !settled.responsePacketHex) {
    return { kind: "drop", reason: "Harbor could not sign a response." };
  }
  return {
    kind: "reply",
    packet: Buffer.from(settled.responsePacketHex, "hex"),
    result: settled.result as AuthResult,
    approvalId: approval.id,
  };
}

function settleInPlace(db: Database, id: string): Approval | null {
  const approval = db.approvals.find((item) => item.id === id);
  if (!approval) return null;
  if (approval.result && approval.responsePacketHex) return approval;
  const device = db.devices.find((item) => item.id === approval.deviceId);
  if (!device) return approval;
  const eventId = randomUUID();
  let decision: { result: AuthResult; wire: WireAttr[] };
  if (approval.status === "approved" && approval.method) {
    decision = decideAccess({
      device,
      service: approval.service,
      groups: approval.groups,
      policies: db.policies,
      eventId,
      method: approval.method,
    });
  } else {
    const reply = approval.status === "expired" ? "Sign-in was not finished in time." : "Denied by Harbor.";
    const reason = approval.denyReason || (approval.status === "expired" ? "The sign-in timed out." : "The sign-in was denied.");
    decision = {
      wire: shortReject(reply),
      result: {
        code: "reject",
        reason,
        replyMessage: reply,
        policyName: null,
        method: approval.method ?? "none",
        attributes: describeAttributes(shortReject(reply)),
      },
    };
  }
  const authenticator = Buffer.from(approval.requestAuthenticatorHex, "hex");
  if (authenticator.length !== 16) return approval;
  const packet = buildResponse({
    code: decision.result.code === "accept" ? 2 : 3,
    identifier: approval.radiusIdentifier ?? 0,
    requestAuthenticator: authenticator,
    secret: device.sharedSecret,
    attributes: decision.wire,
    messageAuthenticator: approval.includeMessageAuthenticator,
  });
  approval.result = decision.result;
  approval.responsePacketHex = packet.toString("hex");
  approval.resolvedAt = approval.resolvedAt ?? new Date().toISOString();
  const started = Date.parse(approval.createdAt);
  device.lastSeenAt = approval.resolvedAt;
  db.events.unshift({
    id: eventId,
    at: approval.resolvedAt,
    username: approval.username,
    deviceId: device.id,
    deviceName: device.name,
    vendor: device.vendor,
    service: approval.service,
    result: decision.result.code,
    reason: decision.result.reason,
    method: decision.result.method,
    latencyMs: Number.isNaN(started) ? 0 : Date.parse(approval.resolvedAt) - started,
    attributes: decision.result.attributes,
    source: approval.source,
  });
  return approval;
}

export async function settle(stage: Stage, id: string): Promise<Approval | null> {
  return withState(stage, (db) => settleInPlace(db, id));
}

export async function getApproval(stage: Stage, id: string): Promise<Approval | null> {
  const db = await readState(stage);
  return db.approvals.find((approval) => approval.id === id) ?? null;
}

export async function expireApproval(stage: Stage, id: string): Promise<Approval | null> {
  return withState(stage, (db) => {
    const approval = db.approvals.find((item) => item.id === id);
    if (!approval) return null;
    if (approval.status === "pending" && Date.parse(approval.expiresAt) <= Date.now()) {
      approval.status = "expired";
      approval.denyReason = "Sign-in was not finished before the device timed out.";
      approval.resolvedAt = new Date().toISOString();
    }
    return settleInPlace(db, id);
  });
}

export async function denyApproval(stage: Stage, id: string): Promise<Approval | { error: string }> {
  return withState(stage, (db) => {
    const approval = db.approvals.find((item) => item.id === id);
    if (!approval) return { error: "That sign-in no longer exists." };
    if (approval.status !== "pending") return { error: "This sign-in is no longer waiting." };
    approval.status = "denied";
    approval.denyReason = "An operator denied this sign-in.";
    approval.resolvedAt = new Date().toISOString();
    return settleInPlace(db, id) ?? { error: "Harbor could not finish the denial." };
  });
}

export async function approveSample(
  stage: Stage,
  id: string,
  userId: string,
): Promise<Approval | { error: string }> {
  return withState(stage, (db) => {
    const approval = db.approvals.find((item) => item.id === id);
    if (!approval) return { error: "That sign-in no longer exists." };
    if (approval.status !== "pending") return { error: "This sign-in is no longer waiting." };
    if (Date.parse(approval.expiresAt) <= Date.now()) {
      approval.status = "expired";
      approval.denyReason = "Sign-in was not finished before the device timed out.";
      approval.resolvedAt = new Date().toISOString();
      return settleInPlace(db, id) ?? { error: "This sign-in timed out." };
    }
    const user = db.users.find((item) => item.id === userId && !item.emergency);
    if (!user) return { error: "That sample account is not in the directory." };
    if (!usernamesMatch(approval.username, user.upn)) {
      return { error: `${user.displayName} does not match ${approval.username}.` };
    }
    approval.status = "approved";
    approval.signedInUpn = user.upn;
    approval.groups = user.groups;
    approval.method = "sample";
    approval.groupSource = "sample";
    approval.resolvedAt = new Date().toISOString();
    return settleInPlace(db, id) ?? { error: "Harbor could not build the RADIUS reply." };
  });
}

export async function approveEntra(
  stage: Stage,
  id: string,
  input: { upn: string; groups: string[]; groupSource: "graph" | "token" },
): Promise<Approval | { error: string }> {
  return withState(stage, (db) => {
    const approval = db.approvals.find((item) => item.id === id);
    if (!approval) return { error: "That sign-in no longer exists." };
    if (approval.status !== "pending") return { error: "This sign-in is no longer waiting." };
    if (!usernamesMatch(approval.username, input.upn)) {
      approval.status = "denied";
      approval.signedInUpn = input.upn;
      approval.groups = input.groups;
      approval.method = "entra";
      approval.groupSource = input.groupSource;
      approval.denyReason = `Microsoft signed in ${input.upn}, and the device asked for ${approval.username}.`;
      approval.resolvedAt = new Date().toISOString();
      return settleInPlace(db, id) ?? { error: "The Microsoft account did not match." };
    }
    if (input.groups.length === 0) {
      approval.status = "denied";
      approval.signedInUpn = input.upn;
      approval.method = "entra";
      approval.groupSource = input.groupSource;
      approval.denyReason = "Microsoft did not return any groups for this account.";
      approval.resolvedAt = new Date().toISOString();
      return settleInPlace(db, id) ?? { error: "No groups were returned." };
    }
    approval.status = "approved";
    approval.signedInUpn = input.upn;
    approval.groups = input.groups;
    approval.method = "entra";
    approval.groupSource = input.groupSource;
    approval.resolvedAt = new Date().toISOString();
    return settleInPlace(db, id) ?? { error: "Harbor could not build the RADIUS reply." };
  });
}

export function timeoutMs(stageSettings: { timeoutSeconds: number }): number {
  return stageSettings.timeoutSeconds * 1000;
}

export async function readTimeout(stage: Stage): Promise<number> {
  const db = await readState(stage);
  return timeoutMs(db.settings);
}

export function newAuthenticator(): Buffer {
  return randomBytes(16);
}

export async function waitForPacket(stage: Stage, approvalId: string): Promise<Buffer | null> {
  const timeout = await readTimeout(stage);
  const start = Date.now();
  while (Date.now() - start < timeout + 1000) {
    const approval = await getApproval(stage, approvalId);
    if (!approval) return null;
    if (approval.responsePacketHex) return Buffer.from(approval.responsePacketHex, "hex");
    if (approval.status !== "pending" || Date.parse(approval.expiresAt) <= Date.now()) {
      const settled = await expireApproval(stage, approvalId);
      if (settled && "responsePacketHex" in settled && settled.responsePacketHex) {
        return Buffer.from(settled.responsePacketHex, "hex");
      }
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const settled = await expireApproval(stage, approvalId);
  if (settled && "responsePacketHex" in settled && settled.responsePacketHex) {
    return Buffer.from(settled.responsePacketHex, "hex");
  }
  return null;
}

export { BREAKGLASS_UPN };
