import "server-only";
import { z } from "zod";
import { structured } from "@/lib/ai/structured";
import { chapterTask, outlineTask, PDF_SYSTEM, rewriteTask } from "./prompts";
import type { PdfChapter, PdfProject } from "./types";

/** IA do Estúdio de PDF (os prompts para IA grátis ficam em ./prompts). */

const OutlineSchema = z.object({
  titulo: z.string(),
  subtitulo: z.string(),
  capitulos: z.array(z.object({ titulo: z.string(), resumo: z.string().describe("O que o capítulo cobre, 1–2 frases") })).describe("Capítulos na ordem"),
});

const ChapterSchema = z.object({ markdown: z.string().describe("Conteúdo completo do capítulo no formato pedido") });
const RewriteSchema = z.object({ texto: z.string() });

export async function aiOutline(p: Pick<PdfProject, "title" | "brief" | "theme">) {
  const { data } = await structured({ schema: OutlineSchema, system: PDF_SYSTEM, maxTokens: 4000, user: outlineTask(p) });
  return data;
}
export async function aiChapter(p: Pick<PdfProject, "title" | "brief" | "theme">, chapters: PdfChapter[], idx: number, extra: string | null) {
  const { data } = await structured({ schema: ChapterSchema, system: PDF_SYSTEM, maxTokens: 16000, user: chapterTask(p, chapters, idx, extra) });
  return data.markdown.replace(/^#\s+.*\n+/, "").trim();
}
export async function aiRewrite(excerpt: string, instruction: string, chapterTitle: string) {
  const { data } = await structured({ schema: RewriteSchema, system: PDF_SYSTEM, maxTokens: 6000, user: rewriteTask(excerpt, instruction, chapterTitle) });
  return data.texto.trim();
}

