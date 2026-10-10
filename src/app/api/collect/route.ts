import { after } from "next/server";
import { clientIp, CORS_HEADERS } from "@/lib/http";
import { processCollect } from "@/lib/ingest/collect";
import { getIngestStore } from "@/lib/ingest";
import { log } from "@/lib/log";

/**
 * Recebe eventos do script (text/plain com JSON, para evitar preflight CORS).
 * O envio para a CAPI acontece depois da resposta (after) para não atrasar a página.
 */
export async function POST(req: Request) {
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > 20_000) return new Response(null, { status: 413, headers: CORS_HEADERS });
    body = JSON.parse(text);
  } catch {
    return new Response(null, { status: 400, headers: CORS_HEADERS });
  }
  try {
    const r = await processCollect(getIngestStore(), body, {
      ip: clientIp(req),
      userAgent: req.headers.get("user-agent"),
      origin: req.headers.get("origin") ?? req.headers.get("referer"),
    });
    if (r.afterResponse) after(r.afterResponse);
    return new Response(r.error ? JSON.stringify({ error: r.error }) : null, { status: r.status === 200 ? 204 : r.status, headers: CORS_HEADERS });
  } catch (e) {
    log.error("collect.failed", { error: e });
    return new Response(null, { status: 500, headers: CORS_HEADERS });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
