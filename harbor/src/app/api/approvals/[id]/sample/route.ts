import { approveSample } from "@/lib/engine";
import { entraConfig } from "@/lib/entra";
import { dataStage, isResponse, json, operator, readJson } from "@/lib/http";
import { presentApproval } from "@/lib/present";
import { readState } from "@/lib/store";

const ID = /^[A-Za-z0-9._-]{1,80}$/;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const { id } = await context.params;
  if (!ID.test(id)) return json({ error: "Unknown sign-in." }, 404);
  const stage = dataStage(identity);
  const db = await readState(stage);
  if (entraConfig(db.settings).ready) {
    return json({ error: "Entra is connected. Sign in with Microsoft." }, 409);
  }
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const userId = body && typeof body === "object" && typeof (body as { userId?: unknown }).userId === "string"
    ? (body as { userId: string }).userId
    : "";
  if (!ID.test(userId)) return json({ error: "Choose a sample account." }, 400);
  const result = await approveSample(stage, id, userId);
  if (!("id" in result)) return json({ error: result.error }, 400);
  return json({ approval: presentApproval(result) });
}
