import { CORS_HEADERS } from "@/lib/http";
import { getIngestStore } from "@/lib/ingest";

/** Configuração pública do site (lida pelo t.js): Pixel, seletores, parâmetro e consentimento. */
export async function GET(req: Request) {
  const site = new URL(req.url).searchParams.get("site") ?? "";
  const found = site ? await getIngestStore().findSiteByPublicKey(site) : null;
  if (!found) return Response.json({ error: "site não encontrado" }, { status: 404, headers: CORS_HEADERS });
  const s = found.site;
  return Response.json(
    { pixelId: s.pixelId, selectors: s.checkoutSelectors, idParam: s.idParam, consentMode: s.consentMode },
    { headers: { ...CORS_HEADERS, "cache-control": "public, max-age=60" } },
  );
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}
