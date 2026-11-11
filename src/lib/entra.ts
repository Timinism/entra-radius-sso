import { createHmac, timingSafeEqual } from "node:crypto";

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

import type { Settings } from "./types";

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TENANT_DOMAIN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export type EntraConfig = {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  ready: boolean;
  tenantFromEnv: boolean;
  clientFromEnv: boolean;
  secretSet: boolean;
};

export function entraConfig(settings: Settings): EntraConfig {
  const tenantFromEnv = Boolean(process.env.ENTRA_TENANT_ID?.trim());
  const clientFromEnv = Boolean(process.env.ENTRA_CLIENT_ID?.trim());
  const secretSet = Boolean(process.env.ENTRA_CLIENT_SECRET?.trim());
  const tenantId = (process.env.ENTRA_TENANT_ID || settings.tenantId || "").trim();
  const clientId = (process.env.ENTRA_CLIENT_ID || settings.clientId || "").trim();
  const clientSecret = (process.env.ENTRA_CLIENT_SECRET || "").trim();
  const tenantOk = GUID.test(tenantId) || TENANT_DOMAIN.test(tenantId);
  const clientOk = GUID.test(clientId);
  return {
    tenantId,
    clientId,
    clientSecret,
    ready: tenantOk && clientOk && clientSecret.length >= 10,
    tenantFromEnv,
    clientFromEnv,
    secretSet,
  };
}

export function publicOrigin(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const host = forwarded || request.headers.get("host")?.trim() || "";
  if (!/^[a-z0-9.-]+(?::\d+)?$/i.test(host)) return null;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const proto =
    forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : host.startsWith("127.") || host.startsWith("localhost")
        ? "http"
        : "https";
  return `${proto}://${host}`;
}

export function signOAuthCookie(payload: object, key: string): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", key).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function readOAuthCookie(
  value: string | undefined,
  key: string,
): { state: string; nonce: string; approvalId: string; exp: number } | null {
  if (!value || !key) return null;
  const [body, mac] = value.split(".");
  if (!body || !mac) return null;
  const expected = createHmac("sha256", key).update(body).digest("base64url");
  const left = Buffer.from(mac);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const record = parsed as Record<string, unknown>;
    if (
      typeof record.state !== "string" ||
      typeof record.nonce !== "string" ||
      typeof record.approvalId !== "string" ||
      typeof record.exp !== "number"
    ) {
      return null;
    }
    if (record.exp < Date.now()) return null;
    return {
      state: record.state,
      nonce: record.nonce,
      approvalId: record.approvalId,
      exp: record.exp,
    };
  } catch {
    return null;
  }
}

export function authorizeUrl(options: {
  config: EntraConfig;
  redirectUri: string;
  state: string;
  nonce: string;
  loginHint: string | null;
}): string {
  const url = new URL(`https://login.microsoftonline.com/${options.config.tenantId}/oauth2/v2.0/authorize`);
  url.searchParams.set("client_id", options.config.clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", "openid profile email User.Read GroupMember.Read.All");
  url.searchParams.set("state", options.state);
  url.searchParams.set("nonce", options.nonce);
  url.searchParams.set("prompt", "select_account");
  if (options.loginHint) url.searchParams.set("login_hint", options.loginHint);
  return url.toString();
}

export async function exchangeCode(options: {
  config: EntraConfig;
  code: string;
  redirectUri: string;
  nonce: string;
}): Promise<{ upn: string; groups: string[]; groupSource: "graph" | "token" } | { error: string }> {
  const tokenUrl = `https://login.microsoftonline.com/${options.config.tenantId}/oauth2/v2.0/token`;
  let response: Response;
  try {
    response = await fetch(tokenUrl, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: options.config.clientId,
        client_secret: options.config.clientSecret,
        grant_type: "authorization_code",
        code: options.code,
        redirect_uri: options.redirectUri,
        scope: "openid profile email User.Read GroupMember.Read.All",
      }),
    });
  } catch {
    return { error: "verify" };
  }
  if (!response.ok) return { error: "entra" };
  const body = (await response.json()) as { id_token?: string; access_token?: string };
  if (!body.id_token) return { error: "verify" };
  let payload: JWTPayload;
  try {
    const jwks = createRemoteJWKSet(
      new URL(`https://login.microsoftonline.com/${options.config.tenantId}/discovery/v2.0/keys`),
    );
    const verified = await jwtVerify(body.id_token, jwks, {
      audience: options.config.clientId,
      issuer: `https://login.microsoftonline.com/${options.config.tenantId}/v2.0`,
      clockTolerance: 60,
    });
    payload = verified.payload;
  } catch {
    return { error: "verify" };
  }
  if (payload.nonce !== options.nonce) return { error: "state" };
  const upn = stringClaim(payload.preferred_username) || stringClaim(payload.upn) || stringClaim(payload.email);
  if (!upn) return { error: "verify" };
  const tokenGroups = groupClaim(payload.groups);
  if (body.access_token) {
    const graph = await graphGroups(body.access_token);
    if (graph && graph.length > 0) return { upn, groups: graph, groupSource: "graph" };
  }
  if (tokenGroups.length > 0) return { upn, groups: tokenGroups, groupSource: "token" };
  return { upn, groups: [], groupSource: "token" };
}

function stringClaim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function groupClaim(value: unknown): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "").map((item) => item.trim());
}

async function graphGroups(accessToken: string): Promise<string[] | null> {
  const groups: string[] = [];
  let next: string | null = "https://graph.microsoft.com/v1.0/me/memberOf?$select=displayName,id&$top=100";
  for (let page = 0; page < 5 && next; page += 1) {
    const url = graphUrl(next);
    if (!url) return groups;
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(8000),
        headers: { authorization: `Bearer ${accessToken}` },
      });
    } catch {
      return null;
    }
    if (response.status === 403 || response.status === 401) return null;
    if (!response.ok) return null;
    const body = (await response.json()) as {
      value?: Array<{ displayName?: string; id?: string }>;
      "@odata.nextLink"?: string;
    };
    for (const entry of body.value ?? []) {
      if (typeof entry.displayName === "string" && entry.displayName.trim()) groups.push(entry.displayName.trim());
      if (typeof entry.id === "string" && entry.id.trim()) groups.push(entry.id.trim());
      if (groups.length >= 200) return groups;
    }
    next = body["@odata.nextLink"] ?? null;
  }
  return groups;
}

function graphUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "graph.microsoft.com") return null;
    return url.toString();
  } catch {
    return null;
  }
}
