import "server-only";
import { isServiceRoleConfigured } from "@/lib/env";
import { PDF_BUCKET, signedUrls } from "@/lib/creative/storage";
import { resolveStorageImages, storageImagePaths } from "./blocks";
import { renderPdf } from "./render";
import type { PdfContent, PdfProject } from "./types";

/** Gera o PDF resolvendo as imagens enviadas ao Storage (URLs assinadas de curta duração). */
export async function buildPdf(project: PdfProject, content: PdfContent, live: boolean): Promise<Buffer> {
  const paths = storageImagePaths(content.chapters.map((c) => c.markdown));
  const urls = live && paths.length && isServiceRoleConfigured() ? await signedUrls(PDF_BUCKET, paths, 600) : new Map<string, string>();
  const resolved: PdfContent = { chapters: content.chapters.map((c) => ({ ...c, markdown: resolveStorageImages(c.markdown, urls) })) };
  return renderPdf(project, resolved);
}

export function pdfFileName(title: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .toLowerCase();
  return `${base || "documento"}.pdf`;
}
