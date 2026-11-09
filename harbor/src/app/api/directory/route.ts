import { dataStage, isResponse, json, operator } from "@/lib/http";
import { presentSettings, presentUser } from "@/lib/present";
import { readState } from "@/lib/store";

export async function GET(request: Request) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const db = await readState(dataStage(identity));
  return json({
    users: db.users.map(presentUser),
    settings: presentSettings(db.settings),
    redirectPath: "/api/entra/callback",
  });
}
