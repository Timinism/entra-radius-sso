import { dataStage, isResponse, json, operator, readJson } from "@/lib/http";
import { withState } from "@/lib/store";

export async function POST(request: Request) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const ids = body && typeof body === "object" && Array.isArray((body as { ids?: unknown }).ids)
    ? (body as { ids: unknown[] }).ids.filter((id): id is string => typeof id === "string")
    : null;
  if (!ids || ids.length > 100) return json({ error: "Send the policy order." }, 400);
  const policies = await withState(dataStage(identity), (db) => {
    const rank = new Map(ids.map((id, index) => [id, (index + 1) * 10]));
    for (const policy of db.policies) {
      const next = rank.get(policy.id);
      if (next !== undefined) policy.priority = next;
    }
    return [...db.policies].sort((a, b) => a.priority - b.priority);
  });
  return json({ policies });
}
