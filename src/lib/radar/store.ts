import { addDays } from "@/lib/tz";
import { AI_SUBNICHES, type AiSubniche } from "./catalog";
import type { HookStatus, NewHook, RadarHook } from "./hooks";
import { WINDOW_DAYS, type RadarSnapshot, type SubnicheMeasure } from "./measure";

/**
 * Armazenamento do radar. Usa a tabela que já existe `campaign_kits` (sem
 * migração), com kinds próprios:
 *  - radar_ia_medicao: 1 linha por dia com a medição de todos os subnichos (histórico);
 *  - radar_ia_gancho: 1 linha por gancho do banco;
 *  - radar_ia_subnicho: subnichos criados por você.
 */
export interface RadarStore {
  readonly mode: "demo" | "live";
  /** Medições mais recentes (até `limit` dias), da mais antiga para a mais nova. */
  listSnapshots(limit?: number): Promise<RadarSnapshot[]>;
  /** Grava a medição do dia (substitui outra do mesmo dia). */
  saveSnapshot(s: RadarSnapshot): Promise<void>;
  listHooks(): Promise<RadarHook[]>;
  addHooks(items: NewHook[]): Promise<number>;
  setHookStatus(id: string, status: HookStatus): Promise<RadarHook | null>;
  deleteHook(id: string): Promise<void>;
  listCustom(): Promise<AiSubniche[]>;
  addCustom(s: AiSubniche): Promise<void>;
  deleteCustom(slug: string): Promise<void>;
}

export const HISTORY_DAYS = 60;

const uid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export class MemoryRadarStore implements RadarStore {
  readonly mode = "demo" as const;
  snapshots: RadarSnapshot[] = [];
  hooks: RadarHook[] = [];
  custom: AiSubniche[] = [];

  async listSnapshots(limit = HISTORY_DAYS) {
    return [...this.snapshots].sort((a, b) => a.date.localeCompare(b.date)).slice(-limit);
  }
  async saveSnapshot(s: RadarSnapshot) {
    this.snapshots = [...this.snapshots.filter((x) => x.date !== s.date), s];
  }
  async listHooks() {
    return [...this.hooks].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async addHooks(items: NewHook[]) {
    const now = new Date().toISOString();
    for (const i of items) this.hooks.push({ ...i, id: uid(), status: "novo", createdAt: now, sentAt: null });
    return items.length;
  }
  async setHookStatus(id: string, status: HookStatus) {
    const h = this.hooks.find((x) => x.id === id);
    if (!h) return null;
    h.status = status;
    if (status === "enviado") h.sentAt = new Date().toISOString();
    return h;
  }
  async deleteHook(id: string) {
    this.hooks = this.hooks.filter((x) => x.id !== id);
  }
  async listCustom() {
    return [...this.custom];
  }
  async addCustom(s: AiSubniche) {
    this.custom = [...this.custom.filter((x) => x.slug !== s.slug), s];
  }
  async deleteCustom(slug: string) {
    this.custom = this.custom.filter((x) => x.slug !== slug);
  }
}

/** Número pseudoaleatório estável por texto (0–1), para o demo não mudar a cada recarga. */
function rand(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

/** Modo demo: 21 dias de medições FICTÍCIAS (dois subnichos subindo) e alguns ganchos. */
export function seedDemoRadar(s: MemoryRadarStore, today: string): void {
  const rising: Record<string, number> = { "automacao-agentes": 0.07, videos: 0.05 };
  for (let d = 20; d >= 0; d--) {
    const date = addDays(today, -d);
    const items: SubnicheMeasure[] = AI_SUBNICHES.map((sub) => {
      const base = 800 + rand(sub.slug) * 30000;
      const trend = Math.pow(1 + (rising[sub.slug] ?? (rand(`${sub.slug}t`) - 0.5) * 0.02), 20 - d);
      const noise = 0.92 + rand(`${sub.slug}${date}`) * 0.16;
      const vpd = Math.round(base * trend * noise);
      const videos = 20 + Math.round(rand(`${sub.slug}v`) * 30);
      const channels = Math.min(videos, 8 + Math.round(rand(`${sub.slug}c`) * 35));
      return {
        slug: sub.slug,
        query: sub.query,
        error: null,
        videos,
        viewsPerDay: vpd,
        medianViewsPerDay: Math.round(vpd / videos),
        channels,
        top3Share: 0.25 + rand(`${sub.slug}s`) * 0.4,
        topVideoShare: 0.1 + rand(`${sub.slug}u`) * 0.3,
        topVideos: [1, 2, 3].map((n) => ({
          id: `demo${n}`,
          title: `[DEMO] Vídeo fictício ${n} sobre ${sub.name.toLowerCase()}`,
          channelTitle: `Canal fictício ${n}`,
          views: Math.round((vpd / (n + 1)) * 5),
          viewsPerDay: Math.round(vpd / (n + 1)),
          publishedAt: `${addDays(date, -5)}T12:00:00Z`,
        })),
      };
    });
    s.snapshots.push({ date, measuredAt: `${date}T09:00:00Z`, windowDays: WINDOW_DAYS, items });
  }
  const now = new Date().toISOString();
  s.hooks.push(
    { id: uid(), slug: "automacao-agentes", text: "Eu parei de responder e-mail na mão — um agente faz isso por mim", source: "manual", reference: null, status: "novo", createdAt: now, sentAt: null },
    { id: uid(), slug: "videos", text: "Esse Reels foi feito inteiro com IA — e ninguém percebeu", source: "ia", reference: "Curiosidade + rapidez", status: "novo", createdAt: now, sentAt: null },
  );
}
