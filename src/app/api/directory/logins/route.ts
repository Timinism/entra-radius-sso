import { issueClientCertificate } from "@/lib/certs";
import { dataStage, isResponse, json, operator, readJson } from "@/lib/http";
import { presentUser } from "@/lib/present";
import { hashPassword } from "@/lib/seed";
import { withState } from "@/lib/store";
import { parseLoginAction, sampleSecret } from "@/lib/validate";

export async function POST(request: Request) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const parsed = parseLoginAction(body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  try {
    const saved = await withState(dataStage(identity), (db) => {
      const user = db.users.find((item) => item.id === parsed.userId);
      if (!user) return { error: "That person is not in the directory." as const };
      if (user.emergency) return { error: "Break-glass keeps its own password. SSL certificates are for directory people." as const };
      if (parsed.action === "clear-local") {
        user.passwordHash = null;
        delete db.settings.shownLocalPasswords[user.id];
      } else if (parsed.action === "generate-local") {
        const password = sampleSecret();
        user.passwordHash = hashPassword(password);
        db.settings.shownLocalPasswords[user.id] = password;
      } else if (parsed.action === "set-local") {
        user.passwordHash = hashPassword(parsed.password);
        delete db.settings.shownLocalPasswords[user.id];
      } else if (parsed.action === "revoke-ssl") {
        user.ssl = null;
      } else if (!db.settings.caCertPem || !db.settings.caKeyPem) {
        return { error: "Harbor has not created its certificate authority yet." as const };
      } else {
        user.ssl = issueClientCertificate(db.settings.caCertPem, db.settings.caKeyPem, user.upn);
      }
      return presentUser(user, db.settings.shownLocalPasswords[user.id] ?? null);
    });
    if ("error" in saved) return json({ error: saved.error }, saved.error.startsWith("That person") ? 404 : 400);
    return json({ user: saved });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update the login.";
    return json({ error: message }, 503);
  }
}
