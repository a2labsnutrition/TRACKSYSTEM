import { safeHeaders } from "@/lib/http";
import { processCaktoWebhook } from "@/lib/ingest/cakto-webhook";
import { getIngestStore } from "@/lib/ingest";

/**
 * Webhook da Cakto. Cole esta URL na Cakto (Integrações → Webhooks).
 * O segredo vem no corpo (campo "secret") e é validado contra o salvo em Conexões.
 * Opcional: ?k=<workspace_id> para identificar o workspace sem depender do segredo.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }
  const k = new URL(req.url).searchParams.get("k");
  const r = await processCaktoWebhook(getIngestStore(), body, safeHeaders(req), { workspaceKey: k });
  return Response.json(r.body, { status: r.status });
}

export function GET() {
  return Response.json({ ok: true, info: "Endpoint de webhook da Cakto. Envie POST com o JSON do evento." });
}
