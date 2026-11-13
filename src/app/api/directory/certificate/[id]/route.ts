import { pkcs12 } from "@/lib/certs";
import { dataStage, isResponse, json, operator } from "@/lib/http";
import { readState } from "@/lib/store";

const ID = /^[A-Za-z0-9._-]{1,80}$/;

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const { id } = await context.params;
  if (!ID.test(id)) return json({ error: "Unknown person." }, 404);
  const db = await readState(dataStage(identity));
  const user = db.users.find((item) => item.id === id);
  if (!user?.ssl || !db.settings.caCertPem) return json({ error: "Issue an SSL certificate for this person first." }, 404);
  const body = pkcs12(user.ssl, db.settings.caCertPem);
  const filename = `${user.upn.split("@")[0] || user.id}.p12`;
  return new Response(new Uint8Array(body), {
    headers: {
      "content-type": "application/x-pkcs12",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}
