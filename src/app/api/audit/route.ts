import { dataStage, isResponse, json, operator } from "@/lib/http";
import { readState } from "@/lib/store";

export async function GET(request: Request) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const db = await readState(dataStage(identity));
  return json({ events: db.events.slice(0, 200) });
}
