import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRepository } from "@/lib/data";
import type { Repository } from "@/lib/data/repository";
import type { Workspace } from "@/lib/data/types";
import { env, isServiceRoleConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import { addDays, resolvePeriod, todayIn } from "@/lib/tz";
import { AI_SUBNICHES, type AiSubniche } from "./catalog";
import type { RadarHook } from "./hooks";
import { measureSubniches, WINDOW_DAYS, type MeasureRun, type RadarSnapshot, type SubnicheMeasure } from "./measure";
import { metaTestsBySlug, type MetaTest } from "./meta";
import { computeRadarScore, growthFor, isHot, latestMeasures, seriesFor, type Growth, type RadarScore } from "./score";
import { MemoryRadarStore, seedDemoRadar, type RadarStore } from "./store";
import { SupabaseRadarStore } from "./supabase-store";

const g = globalThis as unknown as { __ccRadarDemo?: MemoryRadarStore };

export function hasYoutube(): boolean {
  return Boolean(env.youtubeApiKey);
}

export async function getRadarStore(): Promise<{ store: RadarStore; repo: Repository; workspace: Workspace; mode: "demo" | "live" }> {
  const repo = await getRepository();
  const ctx = await repo.context();
  if (ctx.mode === "demo") return { store: demoStore(ctx.workspace.timezone), repo, workspace: ctx.workspace, mode: "demo" };
  return { store: new SupabaseRadarStore(await createSupabaseServer(), ctx.workspace.id), repo, workspace: ctx.workspace, mode: "live" };
}

function demoStore(tz: string): MemoryRadarStore {
  if (!g.__ccRadarDemo) {
    g.__ccRadarDemo = new MemoryRadarStore();
    seedDemoRadar(g.__ccRadarDemo, todayIn(tz));
  }
  return g.__ccRadarDemo;
}

export async function radarSubniches(store: RadarStore): Promise<AiSubniche[]> {
  const custom = await store.listCustom().catch(() => []);
  const slugs = new Set(AI_SUBNICHES.map((s) => s.slug));
  return [...AI_SUBNICHES, ...custom.filter((c) => !slugs.has(c.slug))];
}

export interface RadarRow {
  sub: AiSubniche;
  measure: SubnicheMeasure | null;
  measuredDate: string | null;
  growth: Growth;
  meta: MetaTest | null;
  score: RadarScore;
  hot: boolean;
  series: Array<{ date: string; viewsPerDay: number; channels: number }>;
}

export interface RadarView {
  rows: RadarRow[];
  history: RadarSnapshot[];
  last: RadarSnapshot | null;
  hooks: RadarHook[];
  metaError: string | null;
  metaPeriod: { from: string; to: string };
}

/** Resultados no Meta (30 dias) por subnicho. */
export async function radarMetaTests(repo: Repository, tz: string, slugs: string[]): Promise<{ tests: Map<string, MetaTest>; period: { from: string; to: string } }> {
  const p = resolvePeriod(tz, "30d");
  const [ads, adsets, campaigns, insights, orders] = await Promise.all([repo.ads(), repo.adsets(), repo.campaigns(), repo.insights({ level: "ad", from: p.from, to: p.to }), repo.orders({ from: p.from, to: p.to })]);
  return { tests: metaTestsBySlug({ slugs, ads, adsets, campaigns, insights, orders }), period: { from: p.from, to: p.to } };
}

export function radarRows(subs: AiSubniche[], history: RadarSnapshot[], tests: Map<string, MetaTest>): RadarRow[] {
  const latest = latestMeasures(history);
  return subs
    .map((sub) => {
      const l = latest.get(sub.slug);
      const growth = growthFor(sub.slug, history);
      const meta = tests.get(sub.slug) ?? null;
      return {
        sub,
        measure: l?.m ?? null,
        measuredDate: l?.date ?? null,
        growth,
        meta,
        score: computeRadarScore(sub, l?.m ?? null, growth, meta, l?.date ?? null),
        hot: isHot(l?.m, growth),
        series: seriesFor(sub.slug, history),
      };
    })
    .sort((a, b) => (b.score.total ?? -1) - (a.score.total ?? -1));
}

export async function buildRadarView(repo: Repository, store: RadarStore, ws: Workspace): Promise<RadarView> {
  const subs = await radarSubniches(store);
  const [history, hooks] = await Promise.all([store.listSnapshots(), store.listHooks()]);
  let tests = new Map<string, MetaTest>();
  let metaError: string | null = null;
  let metaPeriod = { from: addDays(todayIn(ws.timezone), -29), to: todayIn(ws.timezone) };
  try {
    const r = await radarMetaTests(repo, ws.timezone, subs.map((s) => s.slug));
    tests = r.tests;
    metaPeriod = r.period;
  } catch (e) {
    metaError = e instanceof Error ? e.message : "Falha ao ler os dados do Meta.";
  }
  return { rows: radarRows(subs, history, tests), history, last: history.at(-1) ?? null, hooks, metaError, metaPeriod };
}

/**
 * Mede e grava a medição do dia. Subnichos que falharem agora mantêm a medição
 * boa que já houver para hoje (não apaga dado bom por erro de cota/rede).
 * `shared` reaproveita medições já feitas nesta execução (cron com vários workspaces).
 */
export async function measureAndSave(
  store: RadarStore,
  subs: AiSubniche[],
  tz: string,
  opts: { shared?: Map<string, SubnicheMeasure>; fetchImpl?: typeof fetch } = {},
): Promise<{ snapshot: RadarSnapshot | null; run: MeasureRun }> {
  const todo = subs.filter((s) => !opts.shared?.has(s.slug));
  const run = todo.length ? await measureSubniches(todo, env.youtubeApiKey, { fetchImpl: opts.fetchImpl }) : { items: [], quotaExhausted: false, errors: 0 };
  for (const m of run.items) if (!m.error) opts.shared?.set(m.slug, m);
  const fresh = new Map(run.items.map((m) => [m.slug, m]));
  for (const s of subs) if (opts.shared?.has(s.slug) && !fresh.has(s.slug)) fresh.set(s.slug, opts.shared.get(s.slug)!);
  const items = subs.map((s) => fresh.get(s.slug)!).filter(Boolean);
  if (!items.some((i) => !i.error)) return { snapshot: null, run };
  const date = todayIn(tz);
  const prev = (await store.listSnapshots(1)).find((x) => x.date === date);
  const merged = items.map((i) => (i.error ? (prev?.items.find((p) => p.slug === i.slug && !p.error) ?? i) : i));
  const snapshot: RadarSnapshot = { date, measuredAt: new Date().toISOString(), windowDays: WINDOW_DAYS, items: merged };
  await store.saveSnapshot(snapshot);
  return { snapshot, run };
}

export interface RadarHotItem {
  slug: string;
  name: string;
  growthPct: number;
  viewsPerDay: number;
}

/** Subnichos em alta na medição mais recente (só se ela tiver até 2 dias). */
export function hotFromHistory(subs: AiSubniche[], history: RadarSnapshot[], today: string): RadarHotItem[] {
  const last = history.at(-1);
  if (!last || last.date < addDays(today, -2)) return [];
  const out: RadarHotItem[] = [];
  for (const sub of subs) {
    const m = last.items.find((i) => i.slug === sub.slug && !i.error);
    const growth = growthFor(sub.slug, history);
    if (m && isHot(m, growth)) out.push({ slug: sub.slug, name: sub.name, growthPct: growth.pct!, viewsPerDay: m.viewsPerDay });
  }
  return out.sort((a, b) => b.growthPct - a.growthPct);
}

/** Lista para o motor de alertas (falha vira lista vazia: radar nunca derruba os alertas). */
export async function radarHotFor(mode: "demo" | "live", ws: Pick<Workspace, "id" | "timezone">, db: SupabaseClient | null): Promise<RadarHotItem[]> {
  try {
    const store = mode === "demo" ? demoStore(ws.timezone) : db ? new SupabaseRadarStore(db, ws.id) : null;
    if (!store) return [];
    return hotFromHistory(await radarSubniches(store), await store.listSnapshots(14), todayIn(ws.timezone));
  } catch (e) {
    log.warn("radar.hot_failed", { workspaceId: ws.id, error: e });
    return [];
  }
}

const lastAuto = new Map<string, number>();

/**
 * Ao abrir o radar: se ainda não há medição de hoje, mede em segundo plano
 * (depois da resposta) — além do cron diário. Cooldown de 30 min por workspace.
 */
export function needsAutoMeasure(last: RadarSnapshot | null, tz: string): boolean {
  return hasYoutube() && isServiceRoleConfigured() && (!last || last.date !== todayIn(tz));
}

export async function autoMeasureWorkspace(workspaceId: string, tz: string, now = Date.now()): Promise<void> {
  if (now - (lastAuto.get(workspaceId) ?? 0) < 30 * 60_000) return;
  lastAuto.set(workspaceId, now);
  try {
    const db = supabaseAdmin();
    const store = new SupabaseRadarStore(db, workspaceId);
    const last = (await store.listSnapshots(1)).at(-1) ?? null;
    if (last?.date === todayIn(tz)) return;
    const { run } = await measureAndSave(store, await radarSubniches(store), tz);
    log.info("radar.auto_measure", { workspaceId, errors: run.errors, quota: run.quotaExhausted });
    const { runAlertsForWorkspace } = await import("@/lib/alerts/run");
    await runAlertsForWorkspace(db, workspaceId);
  } catch (e) {
    log.warn("radar.auto_measure_failed", { workspaceId, error: e });
  }
}
