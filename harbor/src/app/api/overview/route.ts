import { dataStage, isResponse, json, operator } from "@/lib/http";
import { presentApproval, presentEvent, presentSettings } from "@/lib/present";
import { readState } from "@/lib/store";
import { chicagoDay } from "@/lib/time";
import { listenerStatus } from "@/server/listener";

export async function GET(request: Request) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const db = await readState(dataStage(identity));
  const today = chicagoDay();
  const now = Date.now();
  const events = db.events.filter((event) => chicagoDay(new Date(event.at)) === today);
  const pending = db.approvals
    .filter((approval) => approval.status === "pending" && Date.parse(approval.expiresAt) > now)
    .map(presentApproval);
  return json({
    settings: presentSettings(db.settings),
    listener: listenerStatus,
    devices: db.devices.map((device) => ({
      id: device.id,
      name: device.name,
      vendor: device.vendor,
      os: device.os,
      model: device.model,
      location: device.location,
      service: device.service,
      enabled: device.enabled,
      lastSeenAt: device.lastSeenAt,
    })),
    pending,
    counts: {
      accept: events.filter((event) => event.result === "accept").length,
      reject: events.filter((event) => event.result === "reject").length,
      pending: pending.length,
      devices: db.devices.length,
    },
    events: events.slice(0, 12).map(presentEvent),
  });
}
