import { dataStage, isResponse, json, operator, readJson } from "@/lib/http";
import { withState } from "@/lib/store";
import { parseDevice } from "@/lib/validate";

const ID = /^[A-Za-z0-9._-]{1,80}$/;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const { id } = await context.params;
  if (!ID.test(id)) return json({ error: "Unknown device." }, 404);
  const body = await readJson(request);
  if (isResponse(body)) return body;
  try {
    const saved = await withState(dataStage(identity), (db) => {
      const existing = db.devices.find((device) => device.id === id);
      if (!existing) return { error: "Unknown device." as const };
      const parsed = parseDevice(body, existing);
      if ("error" in parsed) return parsed;
      if (db.devices.some((device) => device.id !== id && device.nasIp === parsed.device.nasIp)) {
        return { error: "Another device already uses that RADIUS source address." };
      }
      parsed.device.id = existing.id;
      Object.assign(existing, parsed.device);
      return existing;
    });
    if ("error" in saved) return json({ error: saved.error }, saved.error === "Unknown device." ? 404 : 400);
    return json({ device: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the device.";
    return json({ error: message }, 503);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const { id } = await context.params;
  if (!ID.test(id)) return json({ error: "Unknown device." }, 404);
  const removed = await withState(dataStage(identity), (db) => {
    const before = db.devices.length;
    db.devices = db.devices.filter((device) => device.id !== id);
    return before !== db.devices.length;
  });
  if (!removed) return json({ error: "Unknown device." }, 404);
  return json({ ok: true });
}
