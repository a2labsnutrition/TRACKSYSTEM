"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AiError } from "@/lib/ai/structured";
import { extOf } from "@/lib/creative/flow";
import { ensureBucket, PDF_BUCKET, signedUpload } from "@/lib/creative/storage";
import { isServiceRoleConfigured } from "@/lib/env";
import { getPdfStore } from "@/lib/pdf";
import { aiChapter, aiOutline, aiRewrite } from "@/lib/pdf/ai";
import { parseOutlineText } from "@/lib/pdf/prompts";
import { pickVersion } from "@/lib/pdf/store";
import { findTemplate } from "@/lib/pdf/templates";
import { mergeOutline, normalizeTheme, type PdfChapter, type PdfTheme } from "@/lib/pdf/types";
import type { ActionState } from "../conexoes/actions";

const fail = (e: unknown): ActionState => ({ ok: false, message: e instanceof AiError || e instanceof Error ? e.message : "Erro inesperado." });
const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};

async function load(id: string) {
  const ctx = await getPdfStore();
  const p = await ctx.store.getProject(id);
  if (!p) throw new Error("PDF não encontrado.");
  const cur = pickVersion(p.versions);
  return { ...ctx, ...p, chapters: cur?.content.chapters ?? [] };
}

async function save(id: string, chapters: PdfChapter[], note: string): Promise<ActionState> {
  const { store } = await getPdfStore();
  const v = await store.saveVersion(id, { chapters }, note);
  revalidatePath(`/pdf/${id}`);
  return { ok: true, message: `Versão ${v} salva.` };
}

export async function createPdfAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id: string;
  try {
    const title = str(form, "title");
    if (!title) return { ok: false, message: "Dê um título ao material." };
    const tpl = findTemplate(str(form, "template"));
    const { store } = await getPdfStore();
    const p = await store.createProject({
      title: title.slice(0, 160),
      brief: (str(form, "brief") ?? "").slice(0, 20_000),
      theme: normalizeTheme({ ...tpl.theme, template: tpl.id }),
      productId: str(form, "productId"),
    });
    await store.saveVersion(p.id, { chapters: tpl.outline.map((o, i) => ({ id: `c${i + 1}`, title: o.title, summary: o.summary, markdown: "" })) }, `Estrutura do modelo “${tpl.name}”`);
    id = p.id;
    revalidatePath("/pdf");
  } catch (e) {
    return fail(e);
  }
  redirect(`/pdf/${id}`);
}

export async function updateProjectAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const id = str(form, "id");
    if (!id) return { ok: false, message: "PDF inválido." };
    const { store } = await load(id);
    await store.updateProject(id, { title: (str(form, "title") ?? "Sem título").slice(0, 160), brief: (str(form, "brief") ?? "").slice(0, 20_000), productId: str(form, "productId") });
    revalidatePath(`/pdf/${id}`);
    return { ok: true, message: "Briefing salvo." };
  } catch (e) {
    return fail(e);
  }
}

export async function updateThemeAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const id = str(form, "id");
    if (!id) return { ok: false, message: "PDF inválido." };
    const { store, project } = await load(id);
    const theme: Partial<PdfTheme> = {
      template: project.theme.template,
      font: str(form, "font") as PdfTheme["font"],
      primary: str(form, "primary") ?? undefined,
      accent: str(form, "accent") ?? undefined,
      pageSize: str(form, "pageSize") as PdfTheme["pageSize"],
      coverSubtitle: str(form, "coverSubtitle") ?? "",
      author: str(form, "author") ?? "",
      header: str(form, "header") ?? "",
      footer: str(form, "footer") ?? "",
      showToc: form.get("showToc") === "1",
      pageNumbers: form.get("pageNumbers") === "1",
    };
    await store.updateProject(id, { theme: normalizeTheme(theme) });
    revalidatePath(`/pdf/${id}`);
    return { ok: true, message: "Visual salvo." };
  } catch (e) {
    return fail(e);
  }
}

export async function outlineAiAction(id: string): Promise<ActionState> {
  try {
    const { project, chapters, store } = await load(id);
    const o = await aiOutline(project);
    if (o.titulo && project.title.length < 3) await store.updateProject(id, { title: o.titulo });
    if (o.subtitulo && !project.theme.coverSubtitle) await store.updateProject(id, { theme: { ...project.theme, coverSubtitle: o.subtitulo } });
    return save(id, mergeOutline(chapters, o.capitulos.map((c) => ({ title: c.titulo, summary: c.resumo }))), "Sumário proposto pela IA");
  } catch (e) {
    return fail(e);
  }
}

/** Sumário editado ou colado: uma linha por capítulo ("Título — resumo"). */
export async function outlineTextAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const id = str(form, "id");
    if (!id) return { ok: false, message: "PDF inválido." };
    const outline = parseOutlineText(str(form, "text") ?? "");
    if (!outline.length) return { ok: false, message: "Escreva pelo menos um capítulo (um por linha)." };
    const { chapters } = await load(id);
    return save(id, mergeOutline(chapters, outline), "Sumário editado");
  } catch (e) {
    return fail(e);
  }
}

export async function chapterAiAction(id: string, chapterId: string, extra: string | null): Promise<ActionState> {
  try {
    const { project, chapters } = await load(id);
    const idx = chapters.findIndex((c) => c.id === chapterId);
    if (idx < 0) return { ok: false, message: "Capítulo não encontrado." };
    const md = await aiChapter(project, chapters, idx, extra?.trim() || null);
    // relê para não perder edições feitas enquanto a IA escrevia outros capítulos
    const fresh = (await load(id)).chapters;
    return save(id, fresh.map((c) => (c.id === chapterId ? { ...c, markdown: md } : c)), `IA escreveu “${chapters[idx].title}”`);
  } catch (e) {
    return fail(e);
  }
}

export async function saveChapterAction(id: string, chapterId: string, title: string, markdown: string): Promise<ActionState> {
  try {
    if (markdown.length > 200_000) return { ok: false, message: "Capítulo grande demais — divida em dois." };
    const { chapters } = await load(id);
    if (!chapters.some((c) => c.id === chapterId)) return { ok: false, message: "Capítulo não encontrado." };
    return save(id, chapters.map((c) => (c.id === chapterId ? { ...c, title: title.trim() || c.title, markdown } : c)), `Editado: “${title.trim()}”`);
  } catch (e) {
    return fail(e);
  }
}

export async function moveChapterAction(id: string, chapterId: string, dir: -1 | 1): Promise<ActionState> {
  try {
    const { chapters } = await load(id);
    const i = chapters.findIndex((c) => c.id === chapterId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= chapters.length) return { ok: true, message: "" };
    const next = [...chapters];
    [next[i], next[j]] = [next[j], next[i]];
    return save(id, next, "Ordem dos capítulos");
  } catch (e) {
    return fail(e);
  }
}

export async function removeChapterAction(id: string, chapterId: string): Promise<ActionState> {
  try {
    const { chapters } = await load(id);
    const c = chapters.find((x) => x.id === chapterId);
    return save(id, chapters.filter((x) => x.id !== chapterId), `Removido: “${c?.title ?? ""}” (recupere pelas versões)`);
  } catch (e) {
    return fail(e);
  }
}

export async function restoreVersionAction(id: string, version: number): Promise<ActionState> {
  try {
    const { versions } = await load(id);
    const v = versions.find((x) => x.version === version);
    if (!v) return { ok: false, message: "Versão não encontrada." };
    return save(id, v.content.chapters, `Restaurada a versão ${version}`);
  } catch (e) {
    return fail(e);
  }
}

export async function rewriteAction(excerpt: string, instruction: string, chapterTitle: string): Promise<{ ok: boolean; message: string; text?: string }> {
  try {
    if (!excerpt.trim() || !instruction.trim()) return { ok: false, message: "Selecione um trecho e escreva o pedido." };
    if (excerpt.length > 20_000) return { ok: false, message: "Trecho grande demais — selecione menos texto." };
    return { ok: true, message: "Trecho reescrito — confira e salve.", text: await aiRewrite(excerpt, instruction, chapterTitle) };
  } catch (e) {
    return fail(e);
  }
}

export async function deletePdfAction(id: string): Promise<ActionState> {
  try {
    const { store } = await load(id);
    await store.deleteProject(id);
    revalidatePath("/pdf");
  } catch (e) {
    return fail(e);
  }
  redirect("/pdf");
}

/** Envio de imagem para o PDF: devolve o trecho ![legenda](storage:...) para colar no capítulo. */
export async function prepareImageAction(id: string, fileName: string, size: number): Promise<{ ok: boolean; message: string; bucket?: string; path?: string; token?: string }> {
  try {
    const { workspace, mode } = await load(id);
    if (mode === "demo") return { ok: false, message: "Modo demo: envio de imagens precisa do Supabase conectado. Use um link https:// de imagem." };
    if (!isServiceRoleConfigured()) return { ok: false, message: "Falta SUPABASE_SERVICE_ROLE_KEY na Vercel." };
    const ext = extOf(fileName);
    if (!["png", "jpg", "jpeg", "webp"].includes(ext)) return { ok: false, message: "Use PNG, JPG ou WEBP." };
    if (size > 8 * 1024 * 1024) return { ok: false, message: "Imagem acima de 8 MB." };
    await ensureBucket(PDF_BUCKET, { mime: ["image/png", "image/jpeg", "image/webp", "application/pdf"], maxMb: 50 });
    const up = await signedUpload(PDF_BUCKET, `${workspace.id}/img/${id}/${Date.now().toString(36)}.${ext}`);
    return { ok: true, message: "", bucket: PDF_BUCKET, path: up.path, token: up.token };
  } catch (e) {
    return fail(e);
  }
}
