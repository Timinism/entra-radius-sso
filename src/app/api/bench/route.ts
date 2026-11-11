import { getApproval, handlePacket, newAuthenticator } from "@/lib/engine";
import { dataStage, isResponse, json, operator, readJson } from "@/lib/http";
import { presentApproval } from "@/lib/present";
import { buildAccessRequest, codeName, describeAttributes, decodePacket } from "@/lib/radius";
import { readState } from "@/lib/store";

const ID = /^[A-Za-z0-9._-]{1,80}$/;

export async function POST(request: Request) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const input = body as { deviceId?: unknown; username?: unknown; service?: unknown; password?: unknown };
  const deviceId = typeof input.deviceId === "string" ? input.deviceId : "";
  const username = typeof input.username === "string" ? input.username.trim() : "";
  if (!ID.test(deviceId)) return json({ error: "Choose a device." }, 400);
  if (!username || username.length > 120 || /[\x00-\x1f\x7f]/.test(username)) {
    return json({ error: "Enter the username the device would send." }, 400);
  }
  const stage = dataStage(identity);
  const db = await readState(stage);
  const device = db.devices.find((item) => item.id === deviceId);
  if (!device || !device.enabled) return json({ error: "That device is not available." }, 404);
  const service = input.service === "globalprotect" ? "globalprotect" : "device-admin";
  const password = typeof input.password === "string" ? input.password.slice(0, 64) : "sso";
  const authenticator = newAuthenticator();
  const packet = buildAccessRequest({
    identifier: authenticator[0] || 1,
    username,
    password,
    secret: device.sharedSecret,
    nasIp: device.nasIp,
    nasIdentifier: device.name,
    globalProtect: service === "globalprotect",
    authenticator,
  });
  const decoded = decodePacket(packet);
  const requestAttributes = "error" in decoded ? [] : describeAttributes(decoded.attributes);
  const result = await handlePacket(stage, packet, device.nasIp, "bench");
  if (result.kind === "drop") return json({ error: result.reason }, 400);
  if (result.kind === "pending") {
    return json({
      pending: true,
      approval: presentApproval(result.approval),
      request: { code: "Access-Request", attributes: requestAttributes },
      response: null,
    });
  }
  const responseDecoded = decodePacket(result.packet);
  const approval = result.approvalId ? await getApproval(stage, result.approvalId) : null;
  return json({
    pending: false,
    approval: approval ? presentApproval(approval) : null,
    request: { code: "Access-Request", attributes: requestAttributes },
    response: {
      code: "error" in responseDecoded ? result.result.code : codeName(responseDecoded.code),
      attributes: "error" in responseDecoded ? result.result.attributes : describeAttributes(responseDecoded.attributes),
      reason: result.result.reason,
      policyName: result.result.policyName,
      method: result.result.method,
    },
  });
}
