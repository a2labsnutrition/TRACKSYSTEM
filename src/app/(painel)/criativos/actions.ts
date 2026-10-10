"use server";

import { revalidatePath } from "next/cache";
import { AiError, hasAi } from "@/lib/ai/structured";
import { generateFlowScenes } from "@/lib/creative/ai";
import { ALLOWED_EXT, extOf, MAX_UPLOAD_MB, nextAdName, pickToday, scenePriority, scenesFromPasted, scenesFromScripts, storagePathFor, type FlowScene, type QueueStatus } from "@/lib/creative/flow";
import { getCreativeStore, learnFromMeta } from "@/lib/creative";
import { angleLessons } from "@/lib/creative/learning";
import { CREATIVE_BUCKET, ensureCreativeBucket, objectExists, removeObject, signedUpload } from "@/lib/creative/storage";
import { campaignBrief, generateCampaignIdeas } from "@/lib/creative/campaign-ideas";
import { getDiscoverStore } from "@/lib/discover";
import { latestSections } from "@/lib/discover/store";
import { isServiceRoleConfigured } from "@/lib/env";
import { todayIn } from "@/lib/tz";
import type { ActionState } from "../conexoes/actions";

const fail = (e: unknown): ActionState => ({ ok: false, message: e instanceof AiError || e instanceof Error ? e.message : "Erro inesperado." });
const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const done = (message: string): ActionState => {
  revalidatePath("/criativos");
  return { ok: true, message };
};

async function addScenes(scenes: FlowScene[], kitId: string | null): Promise<number> {
  const { store, repo, workspace } = await getCreativeStore();
  const today = todayIn(workspace.timezone);
  let scores = new Map<string, number>();
  try {
    scores = angleLessons((await learnFromMeta(repo, store, workspace)).learned).scores;
  } catch {
    // sem dados de desempenho: prioridade só pela ordem
  }
  return store.addQueueItems(scenes.map((s, i) => ({ ...s, kitId, priority: scenePriority(s, i, scores), scheduledFor: today, status: "backlog" as QueueStatus })));
}

export async function importFromKitAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const kitId = str(form, "kitId");
    if (!kitId) return { ok: false, message: "Escolha o kit." };
    const { store: kits } = await getDiscoverStore();
    const k = await kits.getKit(kitId);
    if (!k) return { ok: false, message: "Kit não encontrado." };
    const scripts = latestSections(k.sections).get("scripts");
    if (!scripts) return { ok: false, message: "Este kit ainda não tem roteiros. Gere (ou cole) os roteiros no kit primeiro." };
    const scenes = scenesFromScripts(scripts.data, scripts.format, form.get("withB") === "1");
    if (!scenes.length) return { ok: false, message: "Não encontrei prompts de cena nos roteiros (seção “Prompts para o Google Flow”)." };
    const n = await addScenes(scenes, kitId);
    return done(`${n} prompt(s) do kit “${k.kit.title}” adicionados à lista de espera.`);
  } catch (e) {
    return fail(e);
  }
}

export async function addPastedAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const scenes = scenesFromPasted(str(form, "text") ?? "", str(form, "angle") ?? "geral", str(form, "ratio") ?? "9:16");
    if (!scenes.length) return { ok: false, message: "Cole pelo menos um prompt (um por parágrafo ou por item de lista)." };
    const n = await addScenes(scenes, str(form, "kitId"));
    return done(`${n} prompt(s) adicionados à lista de espera.`);
  } catch (e) {
    return fail(e);
  }
}

export async function generateScenesAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    if (!hasAi()) return { ok: false, message: "Sem ANTHROPIC_API_KEY: use “Copiar prompt” e cole a resposta em “Colar prompts”." };
    const { store, repo, workspace } = await getCreativeStore();
    const { lessons } = angleLessons((await learnFromMeta(repo, store, workspace)).learned);
    const scenes = await generateFlowScenes(lessons, str(form, "focus"));
    const n = await addScenes(scenes, null);
    return done(`${n} nova(s) cena(s) criadas pela IA na lista de espera.`);
  } catch (e) {
    return fail(e);
  }
}

export async function buildTodayAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const capacity = Math.max(1, Math.min(50, Number(str(form, "capacity") ?? 5) || 5));
    const { store, workspace } = await getCreativeStore();
    const today = todayIn(workspace.timezone);
    const { overdue, promote } = pickToday(await store.listQueue(), today, capacity);
    for (const i of promote) await store.updateQueueItem(i.id, { status: "todo", scheduledFor: today });
    if (!promote.length && !overdue.length) return { ok: false, message: "A lista de espera está vazia ou a fila de hoje já está cheia." };
    return done(`${promote.length} prompt(s) entraram na fila de hoje${overdue.length ? ` (+${overdue.length} atrasado(s))` : ""}.`);
  } catch (e) {
    return fail(e);
  }
}

export async function setQueueStatusAction(id: string, status: QueueStatus): Promise<ActionState> {
  try {
    const { store, workspace } = await getCreativeStore();
    await store.updateQueueItem(id, { status, ...(status === "todo" ? { scheduledFor: todayIn(workspace.timezone) } : {}) });
    return done(status === "skipped" ? "Pulado." : status === "backlog" ? "Voltou para a lista de espera." : "Atualizado.");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteQueueItemAction(id: string): Promise<ActionState> {
  try {
    const { store } = await getCreativeStore();
    await store.deleteQueueItem(id);
    return done("Removido.");
  } catch (e) {
    return fail(e);
  }
}

export interface UploadPrep {
  ok: boolean;
  message: string;
  bucket?: string;
  path?: string;
  token?: string;
  adName?: string;
}

/** Prepara o envio: valida o arquivo, define o nome do anúncio e devolve uma URL de envio de uso único. */
export async function prepareUploadAction(i: { fileName: string; size: number; product: string; angle: string; audience: string }): Promise<UploadPrep> {
  try {
    const { store, workspace, mode } = await getCreativeStore();
    if (mode === "demo") return { ok: false, message: "Modo demo: o envio de arquivos precisa do Supabase conectado." };
    if (!isServiceRoleConfigured()) return { ok: false, message: "Falta SUPABASE_SERVICE_ROLE_KEY na Vercel." };
    const ext = extOf(i.fileName);
    if (!ALLOWED_EXT.includes(ext)) return { ok: false, message: `Formato não aceito (.${ext || "?"}). Use ${ALLOWED_EXT.join(", ")}.` };
    if (i.size > MAX_UPLOAD_MB * 1024 * 1024) return { ok: false, message: `Arquivo acima de ${MAX_UPLOAD_MB} MB. Exporte em resolução menor.` };
    const today = todayIn(workspace.timezone);
    const adName = nextAdName({ product: i.product, angle: i.angle, audience: i.audience, date: today, existing: (await store.listAssets()).map((a) => a.adName) });
    await ensureCreativeBucket();
    const up = await signedUpload(CREATIVE_BUCKET, storagePathFor(workspace.id, adName, ext, today));
    return { ok: true, message: "", bucket: CREATIVE_BUCKET, path: up.path, token: up.token, adName };
  } catch (e) {
    return fail(e);
  }
}

/** Depois do envio: confere que o arquivo chegou, registra o criativo e conclui o item da fila. */
export async function confirmUploadAction(i: { path: string; adName: string; angle: string; hook: string | null; kitId: string | null; queueId: string | null }): Promise<ActionState> {
  try {
    const { store, workspace } = await getCreativeStore();
    if (!i.path.startsWith(`${workspace.id}/`)) return { ok: false, message: "Caminho inválido." };
    if (!(await objectExists(CREATIVE_BUCKET, i.path))) return { ok: false, message: "O arquivo não chegou ao Storage. Tente enviar de novo." };
    const asset = await store.addAsset({ kitId: i.kitId, storagePath: i.path, adName: i.adName, angle: i.angle || "geral", hook: i.hook, metaAdId: null });
    if (i.queueId) await store.updateQueueItem(i.queueId, { status: "done", assetId: asset.id });
    return done(`Criativo salvo. Use o nome “${i.adName}” no anúncio do Meta.`);
  } catch (e) {
    return fail(e);
  }
}

export async function renameAssetAction(id: string, adName: string): Promise<ActionState> {
  try {
    const name = adName.trim();
    if (!name) return { ok: false, message: "Nome vazio." };
    const { store } = await getCreativeStore();
    await store.updateAsset(id, { adName: name.slice(0, 200), metaAdId: null });
    return done("Nome atualizado.");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteAssetAction(id: string): Promise<ActionState> {
  try {
    const { store, mode } = await getCreativeStore();
    const a = await store.deleteAsset(id);
    if (a && mode === "live" && isServiceRoleConfigured()) await removeObject(CREATIVE_BUCKET, a.storagePath).catch(() => undefined);
    return done("Criativo removido.");
  } catch (e) {
    return fail(e);
  }
}

/** Ideias de criativos a partir de uma campanha do Meta (IA integrada). */
export async function campaignIdeasAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    if (!hasAi()) return { ok: false, message: "Sem ANTHROPIC_API_KEY: use “Copiar prompt” e cole a resposta em “Colar ideias”." };
    const campaignId = str(form, "campaignId");
    if (!campaignId) return { ok: false, message: "Escolha a campanha." };
    const { repo, workspace } = await getCreativeStore();
    const brief = await campaignBrief(repo, (await getDiscoverStore()).store, workspace, campaignId);
    if (!brief) return { ok: false, message: "Campanha não encontrada." };
    const { ideas, scenes } = await generateCampaignIdeas(brief, str(form, "focus"));
    const n = await addScenes(scenes, null);
    return done(`${ideas.sobre} — ${ideas.ideias.length} ideia(s), ${n} prompt(s) na lista de espera.`);
  } catch (e) {
    return fail(e);
  }
}

/** Resposta colada da IA grátis (formato "## Ângulo" + "### Prompts para o Google Flow"). */
export async function pastedIdeasAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const scenes = scenesFromScripts(str(form, "text") ?? "", "markdown", false);
    if (!scenes.length) return { ok: false, message: "Não encontrei prompts. A resposta precisa ter “## Ângulo: …” e a lista em “### Prompts para o Google Flow”. Se veio em outro formato, use “Colar prompts”." };
    const n = await addScenes(scenes, null);
    return done(`${n} prompt(s) de ${new Set(scenes.map((s) => s.angle)).size} ideia(s) na lista de espera.`);
  } catch (e) {
    return fail(e);
  }
}
