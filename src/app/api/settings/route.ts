import { dataStage, isResponse, json, operator, readJson } from "@/lib/http";
import { entraConfig } from "@/lib/entra";
import { presentSettings } from "@/lib/present";
import { hashPassword } from "@/lib/seed";
import { withState } from "@/lib/store";
import { parseSettings, sampleSecret } from "@/lib/validate";

export async function PATCH(request: Request) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const body = await readJson(request);
  if (isResponse(body)) return body;
  const parsed = parseSettings(body);
  if ("error" in parsed) return json({ error: parsed.error }, 400);
  const settings = await withState(dataStage(identity), (db) => {
    const config = entraConfig(db.settings);
    if (parsed.tenantId !== undefined && !config.tenantFromEnv) db.settings.tenantId = parsed.tenantId;
    if (parsed.clientId !== undefined && !config.clientFromEnv) db.settings.clientId = parsed.clientId;
    if (parsed.breakglassEnabled !== undefined) db.settings.breakglassEnabled = parsed.breakglassEnabled;
    if (parsed.requireMessageAuthenticator !== undefined) {
      db.settings.requireMessageAuthenticator = parsed.requireMessageAuthenticator;
    }
    if (parsed.timeoutSeconds !== undefined) db.settings.timeoutSeconds = parsed.timeoutSeconds;
    if (parsed.radiusHost !== undefined) db.settings.radiusHost = parsed.radiusHost;
    if (parsed.rotateBreakglass) {
      const password = sampleSecret();
      db.settings.breakglassPassword = password;
      const emergency = db.users.find((user) => user.emergency);
      if (emergency) emergency.passwordHash = hashPassword(password);
    }
    return presentSettings(db.settings);
  });
  return json({ settings });
}
