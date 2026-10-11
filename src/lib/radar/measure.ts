import { recentTopVideos, YoutubeError, type YtVideo } from "@/lib/integrations/youtube";
import { median } from "@/lib/stats/core";
import type { AiSubniche } from "./catalog";

/**
 * Medição de demanda no YouTube (determinística, a partir dos dados da API).
 *
 * Para cada subnicho: os até 50 vídeos em português (BR) mais vistos sobre a
 * busca do subnicho, publicados nos últimos WINDOW_DAYS dias.
 *  - views/dia de um vídeo = views ÷ idade em dias (mínimo 1 dia);
 *  - demanda = soma das views/dia desses vídeos (velocidade de audiência do tema agora);
 *  - concorrência = quantos canais diferentes aparecem entre eles (criadores disputando o tema);
 *  - concentração = fatia das views/dia do maior vídeo e dos 3 maiores canais
 *    (demanda puxada por 1 vídeo viral não é tendência).
 * Custo de cota: 101 unidades por subnicho (search = 100, videos = 1) de 10.000/dia.
 */

export const WINDOW_DAYS = 14;
export const MAX_RESULTS = 50;
export const QUOTA_PER_SUBNICHE = 101;

export interface TopVideo {
  id: string;
  title: string;
  channelTitle: string;
  views: number;
  viewsPerDay: number;
  publishedAt: string;
}

export interface SubnicheMeasure {
  slug: string;
  query: string;
  /** Erro desta medição (cota, chave, rede) — números zerados quando houver. */
  error: string | null;
  videos: number;
  viewsPerDay: number;
  medianViewsPerDay: number | null;
  channels: number;
  /** Fatia das views/dia que vem dos 3 canais com mais views/dia (0–1). */
  top3Share: number | null;
  /** Fatia das views/dia que vem do vídeo mais forte (0–1). */
  topVideoShare: number | null;
  topVideos: TopVideo[];
}

export interface RadarSnapshot {
  /** Dia da medição (fuso do workspace). */
  date: string;
  measuredAt: string;
  windowDays: number;
  items: SubnicheMeasure[];
}

const DAY_MS = 86_400_000;

export function ageDays(publishedAt: string, now: number): number {
  const t = new Date(publishedAt).getTime();
  if (!Number.isFinite(t)) return 1;
  return Math.max(1, (now - t) / DAY_MS);
}

/** Resume os vídeos de uma busca em métricas do subnicho. */
export function summarizeVideos(slug: string, query: string, videos: YtVideo[], now: number, windowDays = WINDOW_DAYS): SubnicheMeasure {
  const since = now - windowDays * DAY_MS - DAY_MS; // 1 dia de folga (fusos)
  const valid = videos.filter((v) => {
    const t = new Date(v.publishedAt).getTime();
    return Number.isFinite(t) && t >= since && t <= now + DAY_MS;
  });
  const rows = valid
    .map((v) => ({ id: v.id, title: v.title, channelId: v.channelId || v.channelTitle, channelTitle: v.channelTitle, views: v.views, publishedAt: v.publishedAt, viewsPerDay: v.views / ageDays(v.publishedAt, now) }))
    .sort((a, b) => b.viewsPerDay - a.viewsPerDay);
  const total = rows.reduce((a, r) => a + r.viewsPerDay, 0);
  const byChannel = new Map<string, number>();
  for (const r of rows) byChannel.set(r.channelId, (byChannel.get(r.channelId) ?? 0) + r.viewsPerDay);
  const top3 = [...byChannel.values()].sort((a, b) => b - a).slice(0, 3).reduce((a, b) => a + b, 0);
  return {
    slug,
    query,
    error: null,
    videos: rows.length,
    viewsPerDay: Math.round(total),
    medianViewsPerDay: rows.length ? Math.round(median(rows.map((r) => r.viewsPerDay)) ?? 0) : null,
    channels: byChannel.size,
    top3Share: total > 0 ? top3 / total : null,
    topVideoShare: total > 0 ? rows[0].viewsPerDay / total : null,
    topVideos: rows.slice(0, 5).map((r) => ({ id: r.id, title: r.title, channelTitle: r.channelTitle, views: r.views, viewsPerDay: Math.round(r.viewsPerDay), publishedAt: r.publishedAt })),
  };
}

export function failedMeasure(s: Pick<AiSubniche, "slug" | "query">, error: string): SubnicheMeasure {
  return { slug: s.slug, query: s.query, error, videos: 0, viewsPerDay: 0, medianViewsPerDay: null, channels: 0, top3Share: null, topVideoShare: null, topVideos: [] };
}

/** ISO sem milissegundos (formato RFC 3339 dos exemplos da API). */
export function publishedAfterIso(now: number, windowDays = WINDOW_DAYS): string {
  return new Date(now - windowDays * DAY_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export interface MeasureRun {
  items: SubnicheMeasure[];
  quotaExhausted: boolean;
  errors: number;
}

/**
 * Mede uma lista de subnichos (4 em paralelo). Cota esgotada interrompe o resto
 * (cada item restante fica com o erro, sem chamadas à toa).
 */
export async function measureSubniches(
  subs: Array<Pick<AiSubniche, "slug" | "query">>,
  key: string,
  opts: { now?: number; fetchImpl?: typeof fetch; concurrency?: number } = {},
): Promise<MeasureRun> {
  const now = opts.now ?? Date.now();
  const after = publishedAfterIso(now);
  const out = new Map<string, SubnicheMeasure>();
  let quotaExhausted = false;
  const queue = [...subs];
  const worker = async () => {
    for (let s = queue.shift(); s; s = queue.shift()) {
      if (quotaExhausted) {
        out.set(s.slug, failedMeasure(s, "Não medido: cota diária do YouTube esgotada."));
        continue;
      }
      try {
        const videos = await recentTopVideos(s.query, after, key, opts.fetchImpl);
        out.set(s.slug, summarizeVideos(s.slug, s.query, videos, now));
      } catch (e) {
        const msg = e instanceof YoutubeError ? e.message : "Falha de rede ao consultar o YouTube.";
        if (/cota/i.test(msg)) quotaExhausted = true;
        out.set(s.slug, failedMeasure(s, msg));
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency ?? 4, subs.length)) }, worker));
  const items = subs.map((s) => out.get(s.slug) ?? failedMeasure(s, "Não medido."));
  return { items, quotaExhausted, errors: items.filter((i) => i.error).length };
}
