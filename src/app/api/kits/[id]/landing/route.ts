import { buildLandingHtml } from "@/lib/discover/landing-html";
import { loadKitView } from "@/lib/discover/kit-view";
import { slugPart } from "@/lib/discover/structure";

/** Baixa a página de vendas do kit como um único arquivo HTML. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = Number(new URL(req.url).searchParams.get("v")) || null;
  let view;
  try {
    view = await loadKitView(id, { landing: v ?? undefined });
  } catch {
    return new Response("Faça login para baixar.", { status: 401 });
  }
  if (!view) return new Response("Kit não encontrado.", { status: 404 });
  if (!view.landingData) return new Response("Gere a página de vendas do kit primeiro.", { status: 404 });
  const html = buildLandingHtml({
    landing: view.landingData,
    offer: view.offerData,
    productName: view.productName,
    checkoutUrl: view.kit.inputs.checkoutUrl ?? null,
    trackingSnippet: view.trackingSnippet,
  });
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-disposition": `attachment; filename="pagina-${slugPart(view.productName)}.html"`,
      "cache-control": "private, no-store",
    },
  });
}
