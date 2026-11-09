import {
  describeAttributes,
  u32Attr,
  utf8Attr,
  vendorAttr,
  type WireAttr,
} from "./radius";
import type { AdminService, AuthResult, Device, DisplayAttr, Policy } from "./types";

export function matchPolicy(
  policies: Policy[],
  groups: string[],
  vendor: Device["vendor"],
  service: AdminService,
): Policy | null {
  const held = new Set(groups.map((group) => group.trim().toLowerCase()).filter(Boolean));
  const ordered = [...policies]
    .filter((policy) => policy.enabled)
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  for (const policy of ordered) {
    if (policy.vendor !== vendor || policy.service !== service) continue;
    if (!held.has(policy.entraGroup.trim().toLowerCase())) continue;
    return policy;
  }
  return null;
}

export function attributesFor(
  policy: Policy,
  device: Device,
  service: AdminService,
  eventId: string,
): WireAttr[] {
  const attributes: WireAttr[] = [];
  if (device.vendor === "cisco" && service === "device-admin") {
    const privilege = clampPrivilege(policy.ciscoPrivLevel ?? 1);
    attributes.push(u32Attr(6, privilege >= 15 ? 6 : 7));
    attributes.push(vendorAttr(9, 1, `shell:priv-lvl=${privilege}`));
    if (policy.ciscoRole) {
      attributes.push(vendorAttr(9, 1, `shell:roles=${policy.ciscoRole}`));
    }
  }
  if (device.vendor === "paloalto" && service === "device-admin") {
    if (device.os === "panorama") {
      const role = policy.paPanoramaRole || policy.paAdminRole;
      const domain = policy.paPanoramaDomain || policy.paAccessDomain;
      if (role) attributes.push(vendorAttr(25461, 3, role));
      if (domain) attributes.push(vendorAttr(25461, 4, domain));
    } else {
      if (policy.paAdminRole) attributes.push(vendorAttr(25461, 1, policy.paAdminRole));
      if (policy.paAccessDomain) attributes.push(vendorAttr(25461, 2, policy.paAccessDomain));
    }
  }
  if (device.vendor === "paloalto" && service === "globalprotect" && policy.paUserGroup) {
    attributes.push(vendorAttr(25461, 5, policy.paUserGroup));
  }
  attributes.push(utf8Attr(25, `harbor:${eventId}`));
  return attributes;
}

function clampPrivilege(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.max(0, Math.min(15, Math.trunc(value)));
}

export function decideAccess(input: {
  device: Device;
  service: AdminService;
  groups: string[];
  policies: Policy[];
  eventId: string;
  method: AuthResult["method"];
}): { result: AuthResult; wire: WireAttr[] } {
  const policy = matchPolicy(input.policies, input.groups, input.device.vendor, input.service);
  if (!policy || !policyGrants(policy, input.device, input.service)) {
    const wire = [utf8Attr(18, "No Harbor policy matched.")];
    return {
      wire,
      result: {
        code: "reject",
        reason: `No policy grants ${input.groups.join(", ") || "this sign-in"} ${accessLabel(input.device, input.service)}.`,
        replyMessage: "No Harbor policy matched.",
        policyName: null,
        method: input.method,
        attributes: describeAttributes(wire),
      },
    };
  }
  const wire = attributesFor(policy, input.device, input.service, input.eventId);
  const attributes = describeAttributes(wire);
  return {
    wire,
    result: {
      code: "accept",
      reason: grantSentence(policy, input.device, input.service, attributes),
      replyMessage: "",
      policyName: policy.name,
      method: input.method,
      attributes,
    },
  };
}

function policyGrants(policy: Policy, device: Device, service: AdminService): boolean {
  if (device.vendor === "cisco") return policy.ciscoPrivLevel !== null;
  if (service === "globalprotect") return Boolean(policy.paUserGroup);
  if (device.os === "panorama") return Boolean(policy.paPanoramaRole || policy.paAdminRole);
  return Boolean(policy.paAdminRole);
}

function accessLabel(device: Device, service: AdminService): string {
  if (service === "globalprotect") return `GlobalProtect on ${device.name}`;
  if (device.vendor === "cisco") return `a Cisco exec shell on ${device.name}`;
  if (device.os === "panorama") return `Panorama admin on ${device.name}`;
  return `firewall admin on ${device.name}`;
}

function grantSentence(
  policy: Policy,
  device: Device,
  service: AdminService,
  attributes: DisplayAttr[],
): string {
  if (device.vendor === "cisco") {
    const privilege = attributes.find((attr) => attr.name === "Cisco-AVPair" && attr.value.startsWith("shell:priv-lvl="));
    return `${policy.name} grants ${privilege?.value ?? "Cisco exec"} on ${device.name}.`;
  }
  if (service === "globalprotect") {
    const group = attributes.find((attr) => attr.name === "PaloAlto-User-Group");
    return `${policy.name} places the session in ${group?.value ?? "a GlobalProtect group"}.`;
  }
  const role = attributes.find((attr) => attr.name.endsWith("Admin-Role"));
  return `${policy.name} grants ${role?.value ?? "an admin role"} on ${device.name}.`;
}

export function serviceFor(
  device: Device,
  globalProtectHint: boolean,
): AdminService | { error: string } {
  if (device.service === "device-admin") return "device-admin";
  if (device.service === "globalprotect") return "globalprotect";
  return globalProtectHint ? "globalprotect" : "device-admin";
}
