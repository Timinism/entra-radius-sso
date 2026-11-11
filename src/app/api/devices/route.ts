import { dataStage, isResponse, json, operator, readJson } from "@/lib/http";
import { readState, withState } from "@/lib/store";
import { parseDevice } from "@/lib/validate";

export async function GET(request: Request) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const db = await readState(dataStage(identity));
  return json({ devices: db.devices });
}

export async function POST(request: Request) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const parsed = parseDevice(body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  try {
    const saved = await withState(dataStage(identity), (db) => {
      if (db.devices.some((device) => device.id === parsed.device.id || device.nasIp === parsed.device.nasIp)) {
        return { error: "A device with that name or RADIUS source address already exists." };
      }
      db.devices.push(parsed.device);
      return parsed.device;
    });
    if ("error" in saved) return json({ error: saved.error }, 409);
    return json({ device: saved }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save the device.";
    return json({ error: message }, 503);
  }
}
