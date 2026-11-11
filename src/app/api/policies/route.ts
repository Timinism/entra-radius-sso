import { randomUUID } from "node:crypto";

import { dataStage, isResponse, json, operator, readJson } from "@/lib/http";
import { readState, withState } from "@/lib/store";
import { parsePolicy } from "@/lib/validate";

export async function GET(request: Request) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const db = await readState(dataStage(identity));
  const policies = [...db.policies].sort((a, b) => a.priority - b.priority);
  return json({ policies });
}

export async function POST(request: Request) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const parsed = parsePolicy(body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  const saved = await withState(dataStage(identity), (db) => {
    if (db.policies.some((policy) => policy.id === parsed.policy.id)) {
      parsed.policy.id = `${parsed.policy.id}-${randomUUID().slice(0, 8)}`;
    }
    db.policies.push(parsed.policy);
    return parsed.policy;
  });
  return json({ policy: saved }, 201);
}
