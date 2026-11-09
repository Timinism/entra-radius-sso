import { expireApproval, getApproval, settle } from "@/lib/engine";
import { dataStage, isResponse, json, operator } from "@/lib/http";
import { presentApproval } from "@/lib/present";

const ID = /^[A-Za-z0-9._-]{1,80}$/;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const { id } = await context.params;
  if (!ID.test(id)) return json({ error: "Unknown sign-in." }, 404);
  const stage = dataStage(identity);
  let approval = await getApproval(stage, id);
  if (!approval) return json({ error: "Unknown sign-in." }, 404);
  if (approval.status === "pending" && Date.parse(approval.expiresAt) <= Date.now()) {
    approval = await expireApproval(stage, id);
  } else if (approval.status !== "pending" && !approval.result) {
    approval = await settle(stage, id);
  }
  if (!approval) return json({ error: "Unknown sign-in." }, 404);
  return json({ approval: presentApproval(approval) });
}
