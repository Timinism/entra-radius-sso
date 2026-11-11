import { dataStage, isResponse, json, operator } from "@/lib/http";
import { presentApproval } from "@/lib/present";
import { readState } from "@/lib/store";

export async function GET(request: Request) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const db = await readState(dataStage(identity));
  const now = Date.now();
  const approvals = db.approvals
    .filter((approval) => approval.status === "pending" || Date.parse(approval.createdAt) > now - 1000 * 60 * 60 * 12)
    .map(presentApproval);
  return json({ approvals });
}
