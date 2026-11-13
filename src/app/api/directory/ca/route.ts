import { dataStage, isResponse, operator } from "@/lib/http";
import { readState } from "@/lib/store";

export async function GET(request: Request) {
  const identity = await operator(request);
  if (isResponse(identity)) return identity;
  const db = await readState(dataStage(identity));
  if (!db.settings.caCertPem) return Response.json({ error: "Harbor has no certificate authority yet." }, { status: 404 });
  return new Response(db.settings.caCertPem, {
    headers: {
      "content-type": "application/x-pem-file",
      "content-disposition": "attachment; filename=\"harbor-ca.pem\"",
      "cache-control": "no-store",
    },
  });
}
