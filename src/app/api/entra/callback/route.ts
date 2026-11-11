import { NextResponse, type NextRequest } from "next/server";

import { approveEntra } from "@/lib/engine";
import { entraConfig, exchangeCode, publicOrigin, readOAuthCookie } from "@/lib/entra";
import { dataStage, isResponse, operator } from "@/lib/http";
import { readState } from "@/lib/store";

const ERRORS = new Set(["entra", "mismatch", "verify", "state", "config", "groups"]);

export async function GET(request: NextRequest) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const origin = publicOrigin(request);
  if (!origin) return NextResponse.redirect(new URL("/approvals?error=state", request.url));
  const stage = dataStage(identity);
  const db = await readState(stage);
  const cookie = readOAuthCookie(request.cookies.get("harbor_oauth")?.value, db.settings.cookieKey);
  const fallback = cookie ? `/approvals/${cookie.approvalId}` : "/approvals";
  const fail = (code: string) => {
    const safe = ERRORS.has(code) ? code : "entra";
    const response = NextResponse.redirect(`${origin}${fallback}?error=${safe}`);
    response.cookies.set("harbor_oauth", "", { httpOnly: true, path: "/", maxAge: 0 });
    return response;
  };
  if (!cookie) return fail("state");
  const url = request.nextUrl;
  if (url.searchParams.get("state") !== cookie.state) return fail("state");
  if (url.searchParams.get("error")) return fail("entra");
  const code = url.searchParams.get("code");
  if (!code || code.length > 2048) return fail("entra");
  const config = entraConfig(db.settings);
  if (!config.ready) return fail("config");
  const exchanged = await exchangeCode({
    config,
    code,
    redirectUri: `${origin}/api/entra/callback`,
    nonce: cookie.nonce,
  });
  if ("error" in exchanged) return fail(exchanged.error);
  const settled = await approveEntra(stage, cookie.approvalId, exchanged);
  if (!("status" in settled)) return fail("state");
  if (settled.status === "denied") {
    const reason = settled.denyReason ?? "";
    if (reason.startsWith("Microsoft signed in")) return fail("mismatch");
    if (reason.includes("did not return any groups")) return fail("groups");
  }
  const response = NextResponse.redirect(`${origin}/approvals/${cookie.approvalId}`);
  response.cookies.set("harbor_oauth", "", { httpOnly: true, path: "/", maxAge: 0 });
  return response;
}
