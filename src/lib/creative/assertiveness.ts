import type { CreativeVerdict } from "./intelligence";

/**
 * Assertividade de cada anúncio DENTRO da campanha.
 *  1. Vendas: veredicto estatístico da inteligência de criativos (comprovado
 *     só com teste contra o restante — gasto alto não é prova).
 *  2. Sinais de atenção comparados à mediana da campanha (só com 1.000+
 *     impressões): gancho (3s ÷ impressões), retenção (ThruPlay ÷ 3s),
 *     CTR do link e connect rate (página carregou ÷ cliques).
 * Nada de nota inventada: cada rótulo diz de onde veio.
 */

export interface AdSignalsInput {
  id: string;
  impressions: number;
  isVideo: boolean;
  verdict: CreativeVerdict;
  hookRate: number | null;
  holdRate: number | null;
  ctrLink: number | null;
  connectRate: number | null;
  fatigued: boolean;
}

export type SignalLevel = "acima" | "na_media" | "abaixo";

export interface AdSignal {
  key: "hook" | "hold" | "ctr" | "connect";
  label: string;
  value: number;
  median: number;
  level: SignalLevel;
}

export type Assertiveness = "vendendo_acima" | "promissor" | "na_media" | "fraco" | "sem_dados";

export const ASSERTIVENESS_LABEL: Record<Assertiveness, string> = {
  vendendo_acima: "Vendendo acima (comprovado)",
  promissor: "Promissor",
  na_media: "Na média",
  fraco: "Fraco",
  sem_dados: "Pouco dado",
};

export interface AdAssessment {
  id: string;
  level: Assertiveness;
  signals: AdSignal[];
  strengths: string[];
  weaknesses: string[];
}

const MIN_IMPRESSIONS = 1000;
const BAND = 0.15;

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const pct = (v: number) => `${(v * 100).toFixed(1).replace(".", ",")}%`;

const SIGNALS: Array<{ key: AdSignal["key"]; label: string; get: (a: AdSignalsInput) => number | null; videoOnly: boolean; good: string; bad: string }> = [
  { key: "hook", label: "Gancho (3s)", get: (a) => a.hookRate, videoOnly: true, good: "segura a atenção nos 3 primeiros segundos", bad: "perde gente nos 3 primeiros segundos — troque o início" },
  { key: "hold", label: "Retenção", get: (a) => a.holdRate, videoOnly: true, good: "quem começa assiste até o fim", bad: "o meio do vídeo perde a atenção — encurte ou mude o ritmo" },
  { key: "ctr", label: "CTR do link", get: (a) => a.ctrLink, videoOnly: false, good: "gera clique acima da campanha", bad: "pouco clique — a chamada/oferta no anúncio não convence" },
  { key: "connect", label: "Connect rate", get: (a) => a.connectRate, videoOnly: false, good: "quem clica chega na página", bad: "quem clica não chega na página (lentidão ou público curioso)" },
];

export function assessAds(ads: AdSignalsInput[]): Map<string, AdAssessment> {
  const eligible = ads.filter((a) => a.impressions >= MIN_IMPRESSIONS);
  const medians = new Map(
    SIGNALS.map((s) => [s.key, median(eligible.filter((a) => !s.videoOnly || a.isVideo).map(s.get).filter((v): v is number => v != null && Number.isFinite(v)))]),
  );
  const out = new Map<string, AdAssessment>();
  for (const a of ads) {
    const signals: AdSignal[] = [];
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    if (a.impressions >= MIN_IMPRESSIONS && eligible.length >= 2) {
      for (const s of SIGNALS) {
        if (s.videoOnly && !a.isVideo) continue;
        const v = s.get(a);
        const m = medians.get(s.key);
        if (v == null || m == null || m <= 0) continue;
        const level: SignalLevel = v >= m * (1 + BAND) ? "acima" : v <= m * (1 - BAND) ? "abaixo" : "na_media";
        signals.push({ key: s.key, label: s.label, value: v, median: m, level });
        if (level === "acima") strengths.push(`${s.label} ${pct(v)} vs ${pct(m)} da campanha: ${s.good}.`);
        if (level === "abaixo") weaknesses.push(`${s.label} ${pct(v)} vs ${pct(m)} da campanha: ${s.bad}.`);
      }
    }
    if (a.fatigued) weaknesses.push("Sinais de fadiga (CTR/gancho caindo com frequência subindo) — hora de uma variação.");
    const up = signals.filter((s) => s.level === "acima").length;
    const down = signals.filter((s) => s.level === "abaixo").length;
    let level: Assertiveness;
    if (a.verdict === "destaque_comprovado") level = "vendendo_acima";
    else if (a.verdict === "abaixo_comprovado" || a.verdict === "gasto_sem_venda") level = "fraco";
    else if (a.impressions < MIN_IMPRESSIONS || (a.verdict === "pouco_gasto" && !signals.length)) level = "sem_dados";
    else if (a.verdict === "sinal_positivo" || up >= 2) level = down >= 2 ? "na_media" : "promissor";
    else if (down >= 2) level = "fraco";
    else level = "na_media";
    out.set(a.id, { id: a.id, level, signals, strengths, weaknesses });
  }
  return out;
}
