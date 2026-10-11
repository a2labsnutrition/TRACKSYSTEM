"use server";

import { revalidatePath } from "next/cache";
import { AiError, hasAi } from "@/lib/ai/structured";
import { runAlertsForWorkspace } from "@/lib/alerts/run";
import { getCreativeStore } from "@/lib/creative";
import { isServiceRoleConfigured } from "@/lib/env";
import { getRadarStore, hasYoutube, measureAndSave, radarSubniches } from "@/lib/radar";
import { generateHooks } from "@/lib/radar/ai";
import { AI_SUBNICHES, slugify, type AiSubniche } from "@/lib/radar/catalog";
import { dedupeHooks, hookScene, hooksFromVideos, parseHooks, type HookSource, type HookStatus, type RadarHook } from "@/lib/radar/hooks";
import { QUOTA_PER_SUBNICHE } from "@/lib/radar/measure";
import { growthFor, isHot, latestMeasures } from "@/lib/radar/score";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { todayIn } from "@/lib/tz";
import type { ActionState } from "../conexoes/actions";

const fail = (e: unknown): ActionState => ({ ok: false, message: e instanceof AiError || e instanceof Error ? e.message : "Erro inesperado." });
const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const done = (message: string, alsoCreatives = false): ActionState => {
  revalidatePath("/radar-ia");
  if (alsoCreatives) revalidatePath("/criativos");
  return { ok: true, message };
};

/** Intervalo mínimo entre medições manuais (protege a cota diária de 10.000 unidades). */
const MANUAL_COOLDOWN_MS = 2 * 60 * 60_000;

export async function measureNowAction(): Promise<ActionState> {
  try {
    const { store, workspace, mode } = await getRadarStore();
    if (mode === "demo") return { ok: false, message: "No demo as medições são fictícias. Saia do demo e configure a YOUTUBE_API_KEY na Vercel para medir de verdade." };
    if (!hasYoutube()) return { ok: false, message: "Falta a YOUTUBE_API_KEY na Vercel (veja o passo a passo nesta página)." };
    const last = (await store.listSnapshots(1)).at(-1);
    const age = last ? Date.now() - new Date(last.measuredAt).getTime() : Infinity;
    if (age < MANUAL_COOLDOWN_MS) {
      return { ok: false, message: `Última medição há ${Math.round(age / 60_000)} min. Para poupar a cota do YouTube, meça de novo depois de 2 h (o radar também mede sozinho 1×/dia).` };
    }
    const subs = await radarSubniches(store);
    const { snapshot, run } = await measureAndSave(store, subs, workspace.timezone);
    if (isServiceRoleConfigured()) await runAlertsForWorkspace(supabaseAdmin(), workspace.id).catch(() => null);
    if (!snapshot) return { ok: false, message: run.items[0]?.error ?? "Nenhum subnicho foi medido." };
    const ok = run.items.length - run.errors;
    return done(`${ok} subnicho(s) medidos (~${ok * QUOTA_PER_SUBNICHE} unidades de cota).${run.errors ? ` ${run.errors} com erro${run.quotaExhausted ? " (cota esgotada)" : ""}.` : ""}`);
  } catch (e) {
    return fail(e);
  }
}

async function findSub(slug: string | null): Promise<{ sub: AiSubniche | undefined; store: Awaited<ReturnType<typeof getRadarStore>>["store"] }> {
  const { store } = await getRadarStore();
  const sub = slug ? (await radarSubniches(store)).find((s) => s.slug === slug) : undefined;
  return { sub, store };
}

async function addHooks(slug: string, texts: string[], source: HookSource, reference: string | null): Promise<ActionState> {
  const { sub, store } = await findSub(slug);
  if (!sub) return { ok: false, message: "Subnicho não encontrado." };
  const items = dedupeHooks(
    texts.map((text) => ({ slug, text, source, reference })),
    await store.listHooks(),
  );
  if (!items.length) return { ok: false, message: "Nada novo: esses ganchos já estão no banco." };
  const n = await store.addHooks(items);
  return done(`${n} gancho(s) adicionados ao banco de “${sub.name}”.`);
}

export async function addHooksAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const slug = str(form, "slug");
    const texts = parseHooks(str(form, "text") ?? "");
    if (!slug) return { ok: false, message: "Escolha o subnicho." };
    if (!texts.length) return { ok: false, message: "Escreva pelo menos um gancho (um por linha, 8+ caracteres)." };
    return await addHooks(slug, texts, form.get("source") === "ia" ? "ia" : "manual", form.get("source") === "ia" ? "Colado de uma IA" : null);
  } catch (e) {
    return fail(e);
  }
}

export async function hooksFromYoutubeAction(slug: string): Promise<ActionState> {
  try {
    const { sub, store } = await findSub(slug);
    if (!sub) return { ok: false, message: "Subnicho não encontrado." };
    const m = latestMeasures(await store.listSnapshots(7)).get(slug)?.m;
    if (!m?.topVideos.length) return { ok: false, message: "Sem vídeos medidos para este subnicho ainda. Meça primeiro." };
    const items = dedupeHooks(hooksFromVideos(m), await store.listHooks());
    if (!items.length) return { ok: false, message: "Os títulos dos vídeos mais fortes já estão no banco." };
    const n = await store.addHooks(items);
    return done(`${n} título(s) do YouTube no banco como inspiração — reescreva com suas palavras antes de usar.`);
  } catch (e) {
    return fail(e);
  }
}

export async function generateHooksAction(slug: string): Promise<ActionState> {
  try {
    if (!hasAi()) return { ok: false, message: "Sem ANTHROPIC_API_KEY: use “Copiar prompt (IA grátis)” e cole a resposta em “Colar ganchos”." };
    const { sub, store } = await findSub(slug);
    if (!sub) return { ok: false, message: "Subnicho não encontrado." };
    const [snaps, existing] = await Promise.all([store.listSnapshots(7), store.listHooks()]);
    const m = latestMeasures(snaps).get(slug)?.m ?? null;
    const items = dedupeHooks(await generateHooks(sub, m, existing.filter((h) => h.slug === slug).map((h) => h.text)), existing);
    if (!items.length) return { ok: false, message: "A IA não trouxe ganchos novos. Tente de novo." };
    const n = await store.addHooks(items);
    return done(`${n} gancho(s) criados pela IA para “${sub.name}”.`);
  } catch (e) {
    return fail(e);
  }
}

async function sendHooks(hooks: RadarHook[]): Promise<number> {
  if (!hooks.length) return 0;
  const { store } = await getRadarStore();
  const subs = await radarSubniches(store);
  const snaps = await store.listSnapshots(14);
  const { store: creative, workspace } = await getCreativeStore();
  const today = todayIn(workspace.timezone);
  const items = hooks.flatMap((h, i) => {
    const sub = subs.find((s) => s.slug === h.slug);
    if (!sub) return [];
    const hot = isHot(latestMeasures(snaps).get(sub.slug)?.m, growthFor(sub.slug, snaps));
    return [{ ...hookScene(sub, h), kitId: null, priority: 1000 + (hot ? 100 : 0) - i, scheduledFor: today, status: "backlog" as const }];
  });
  const n = await creative.addQueueItems(items);
  for (const h of hooks) await store.setHookStatus(h.id, "enviado");
  return n;
}

export async function sendHookAction(id: string): Promise<ActionState> {
  try {
    const { store } = await getRadarStore();
    const h = (await store.listHooks()).find((x) => x.id === id);
    if (!h) return { ok: false, message: "Gancho não encontrado." };
    await sendHooks([h]);
    return done("Enviado para a lista de espera de Criativos (ângulo ia-" + h.slug + ").", true);
  } catch (e) {
    return fail(e);
  }
}

export async function sendAllNewAction(slug: string): Promise<ActionState> {
  try {
    const { store } = await getRadarStore();
    const hooks = (await store.listHooks()).filter((h) => h.slug === slug && h.status === "novo");
    if (!hooks.length) return { ok: false, message: "Nenhum gancho novo para enviar." };
    const n = await sendHooks(hooks);
    return done(`${n} gancho(s) enviados para a lista de espera de Criativos.`, true);
  } catch (e) {
    return fail(e);
  }
}

export async function setHookStatusAction(id: string, status: HookStatus): Promise<ActionState> {
  try {
    const { store } = await getRadarStore();
    await store.setHookStatus(id, status);
    return done(status === "descartado" ? "Gancho descartado." : "Gancho restaurado.");
  } catch (e) {
    return fail(e);
  }
}

export async function deleteHookAction(id: string): Promise<ActionState> {
  try {
    const { store } = await getRadarStore();
    await store.deleteHook(id);
    return done("Gancho removido.");
  } catch (e) {
    return fail(e);
  }
}

export async function addSubnicheAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const name = str(form, "name");
    const query = str(form, "query");
    if (!name || !query) return { ok: false, message: "Informe o nome e a busca do YouTube." };
    const { store } = await getRadarStore();
    const existing = new Set((await radarSubniches(store)).map((s) => s.slug));
    // "IA para nutricionistas" -> "nutricionistas" (a etiqueta já começa com ia-)
    const base = slugify(name).replace(/^(ia|inteligencia-artificial)(-(para|com|de|do|da|no|na|nos|nas|e|em))?-/, "") || "subnicho";
    let slug = base;
    for (let i = 2; existing.has(slug); i++) slug = `${base}-${i}`;
    const min = Number(str(form, "ticketMin") ?? 27);
    const max = Number(str(form, "ticketMax") ?? 197);
    const ease = Number(str(form, "ease") ?? 60);
    const level = form.get("policy") === "alto" ? "alto" : form.get("policy") === "medio" ? "medio" : "baixo";
    const sub: AiSubniche = {
      slug,
      name: name.slice(0, 80),
      audience: (str(form, "audience") ?? "Público geral").slice(0, 120),
      promise: (str(form, "promise") ?? name).slice(0, 160),
      query: query.slice(0, 100),
      ticket: { min: Number.isFinite(min) && min > 0 ? min : 27, max: Number.isFinite(max) && max >= min ? max : Math.max(min, 197) },
      ease: Number.isFinite(ease) ? Math.max(0, Math.min(100, Math.round(ease))) : 60,
      policy: { level, reason: str(form, "policyReason") },
      origin: "usuario",
    };
    await store.addCustom(sub);
    return done(`Subnicho “${sub.name}” criado. Etiqueta para os anúncios: ia-${slug}. Ele entra na próxima medição.`);
  } catch (e) {
    return fail(e);
  }
}

export async function deleteSubnicheAction(slug: string): Promise<ActionState> {
  try {
    if (AI_SUBNICHES.some((s) => s.slug === slug)) return { ok: false, message: "Subnichos do catálogo não podem ser removidos." };
    const { store } = await getRadarStore();
    await store.deleteCustom(slug);
    return done("Subnicho removido (o histórico de medições continua guardado).");
  } catch (e) {
    return fail(e);
  }
}
