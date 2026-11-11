import { componentReport } from "@/lib/updater-run";
import { isResponse, json, operator } from "@/lib/http";

export async function GET(request: Request) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const refresh = new URL(request.url).searchParams.get("refresh") === "1";
  try {
    return json(await componentReport(refresh));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Harbor could not read component versions.";
    return json({ error: message }, 502);
  }
}
