import { getPdfStore } from "@/lib/pdf";
import { buildPdf, pdfFileName } from "@/lib/pdf/export";
import { pickVersion } from "@/lib/pdf/store";

export const maxDuration = 120;

/** Baixa o PDF de uma versão do projeto (?v=N; padrão: a mais recente). ?inline=1 abre no navegador. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const url = new URL(req.url);
  let ctx;
  try {
    ctx = await getPdfStore();
  } catch {
    return new Response("Faça login para baixar.", { status: 401 });
  }
  const p = await ctx.store.getProject(id);
  if (!p) return new Response("PDF não encontrado.", { status: 404 });
  const v = pickVersion(p.versions, Number(url.searchParams.get("v")) || null);
  if (!v || !v.content.chapters.length) return new Response("Este PDF ainda não tem capítulos.", { status: 404 });
  const buf = await buildPdf(p.project, v.content, ctx.mode === "live");
  return new Response(new Uint8Array(buf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `${url.searchParams.get("inline") === "1" ? "inline" : "attachment"}; filename="${pdfFileName(p.project.title)}"`,
      "cache-control": "private, no-store",
    },
  });
}
