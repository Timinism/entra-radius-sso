import { randomBytes } from "node:crypto";

import { NextResponse } from "next/server";

import { authorizeUrl, entraConfig, publicOrigin, signOAuthCookie } from "@/lib/entra";
import { dataStage, isResponse, json, operator } from "@/lib/http";
import { readState } from "@/lib/store";
import { loginHint } from "@/lib/username";

const ID = /^[A-Za-z0-9._-]{1,80}$/;

export async function GET(request: Request) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const origin = publicOrigin(request);
  if (!origin) return json({ error: "Harbor could not determine its address." }, 400);
  const approvalId = new URL(request.url).searchParams.get("approval") ?? "";
  if (!ID.test(approvalId)) return json({ error: "Unknown sign-in." }, 404);
  const stage = dataStage(identity);
  const db = await readState(stage);
  const approval = db.approvals.find((item) => item.id === approvalId);
  if (!approval || approval.status !== "pending") {
    return NextResponse.redirect(`${origin}/approvals/${approvalId}?error=state`);
  }
  if (!entraConfig(db.settings).ready) {
    return NextResponse.redirect(`${origin}/approvals/${approvalId}?error=config`);
  }
  const state = randomBytes(16).toString("base64url");
  const nonce = randomBytes(16).toString("base64url");
  const config = entraConfig(db.settings);
  const location = authorizeUrl({
    config,
    redirectUri: `${origin}/api/entra/callback`,
    state,
    nonce,
    loginHint: loginHint(approval.username),
  });
  const response = NextResponse.redirect(location);
  response.cookies.set(
    "harbor_oauth",
    signOAuthCookie({ state, nonce, approvalId, exp: Date.now() + 10 * 60 * 1000 }, db.settings.cookieKey),
    {
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https://"),
      path: "/",
      maxAge: 600,
    },
  );
  return response;
}
