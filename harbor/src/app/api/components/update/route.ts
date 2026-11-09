import { isResponse, json, operator } from "@/lib/http";
import { updateComponents } from "@/lib/updater-run";

export async function POST(request: Request) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  try {
    return json(await updateComponents());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Harbor could not update components.";
    const status = message === "An update is already running." ? 409 : 502;
    return json({ error: message }, status);
  }
}
