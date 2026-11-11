import { dataStage, isResponse, json, operator, readJson } from "@/lib/http";
import { withState } from "@/lib/store";
import { parsePolicy } from "@/lib/validate";

const ID = /^[A-Za-z0-9._-]{1,80}$/;

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const { id } = await context.params;
  if (!ID.test(id)) return json({ error: "Unknown policy." }, 404);
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const saved = await withState(dataStage(identity), (db) => {
    const existing = db.policies.find((policy) => policy.id === id);
    if (!existing) return { error: "Unknown policy." as const };
    const parsed = parsePolicy(body, existing);
    if ("error" in parsed) return parsed;
    parsed.policy.id = existing.id;
    Object.assign(existing, parsed.policy);
    return existing;
  });
  if ("error" in saved) return json({ error: saved.error }, saved.error === "Unknown policy." ? 404 : 400);
  return json({ policy: saved });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const { id } = await context.params;
  if (!ID.test(id)) return json({ error: "Unknown policy." }, 404);
  const removed = await withState(dataStage(identity), (db) => {
    const before = db.policies.length;
    db.policies = db.policies.filter((policy) => policy.id !== id);
    return before !== db.policies.length;
  });
  if (!removed) return json({ error: "Unknown policy." }, 404);
  return json({ ok: true });
}
