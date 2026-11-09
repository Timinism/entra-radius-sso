import { requireIdentity, type VerifiedIdentity } from "../../cursor/identity";

import type { Stage } from "./types";

const buckets = new Map<string, { count: number; reset: number }>();

export function dataStage(identity: VerifiedIdentity): Stage {
  return identity.stage === "preview" ? "preview" : "production";
}

export function viewerOf(identity: VerifiedIdentity): {
  name: string;
  email: string;
  simulated: boolean;
  stage: Stage;
} {
  return {
    name: identity.name || identity.email || "Operator",
    email: identity.email,
    simulated: identity.simulated,
    stage: dataStage(identity),
  };
}

export function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  if (buckets.size > 5000) {
    for (const [entry, bucket] of buckets) {
      if (bucket.reset < now) buckets.delete(entry);
    }
  }
  const bucket = buckets.get(key);
  if (!bucket || now > bucket.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (bucket.count >= limit) return false;
  bucket.count += 1;
  return true;
}

export async function operator(request: Request): Promise<VerifiedIdentity | Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    if (request.headers.get("x-harbor-request") !== "1") {
      return json({ error: "Missing request header." }, 403);
    }
    const origin = request.headers.get("origin");
    const host = request.headers.get("host");
    if (!origin || !host) return json({ error: "Missing origin." }, 403);
    let originHost = "";
    try {
      originHost = new URL(origin).host;
    } catch {
      return json({ error: "Bad origin." }, 403);
    }
    if (originHost !== host) return json({ error: "Cross-site request blocked." }, 403);
    const length = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(length) && length > 100_000) {
      return json({ error: "Request is too large." }, 413);
    }
  }
  const identity = await requireIdentity(request);
  if (identity instanceof Response) return identity;
  if (!rateLimit(identity.sub, request.method === "GET" ? 240 : 60, 60_000)) {
    return json({ error: "Too many requests. Wait a moment and try again." }, 429);
  }
  return identity;
}

export async function readJson(request: Request): Promise<unknown | Response> {
  try {
    return await request.json();
  } catch {
    return json({ error: "Send JSON." }, 400);
  }
}

export function isResponse(value: unknown): value is Response {
  return value instanceof Response;
}
