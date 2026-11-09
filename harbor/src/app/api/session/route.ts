import { chicagoDay } from "@/lib/time";
import { dataStage, isResponse, json, operator, viewerOf } from "@/lib/http";
import { presentSettings } from "@/lib/present";
import { readState } from "@/lib/store";
import { listenerStatus } from "@/server/listener";

export async function GET(request: Request) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const stage = dataStage(identity);
  const db = await readState(stage);
  const now = Date.now();
  const pending = db.approvals.filter(
    (approval) => approval.status === "pending" && Date.parse(approval.expiresAt) > now,
  ).length;
  const settings = presentSettings(db.settings);
  return json({
    viewer: viewerOf(identity),
    mode: settings.mode,
    pending,
    listener: listenerStatus,
    timeoutSeconds: settings.timeoutSeconds,
    day: chicagoDay(),
  });
}
