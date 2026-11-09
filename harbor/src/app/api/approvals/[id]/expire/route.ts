import { expireApproval } from "@/lib/engine";
import { dataStage, isResponse, json, operator } from "@/lib/http";
import { presentApproval } from "@/lib/present";

const ID = /^[A-Za-z0-9._-]{1,80}$/;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const { id } = await context.params;
  if (!ID.test(id)) return json({ error: "Unknown sign-in." }, 404);
  const result = await expireApproval(dataStage(identity), id);
  if (!result) return json({ error: "Unknown sign-in." }, 404);
  return json({ approval: presentApproval(result) });
}
