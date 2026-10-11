import { POLICY_RISK } from "@/lib/discover/niches";
import { fmtBRL, fmtCompact, fmtPct, fmtRoas } from "@/lib/format";
import { addDays, diffDays } from "@/lib/tz";
import type { AiSubniche } from "./catalog";
import type { RadarSnapshot, SubnicheMeasure } from "./measure";
import type { MetaTest } from "./meta";

/**
 * Score do subnicho (0–100) com a ORIGEM de cada parte:
 *  + Demanda (30%) ............ YouTube (medido): views/dia dos vídeos recentes, em escala log.
 *  + Crescimento (20%) ........ YouTube (medido no histórico do radar): demanda de hoje vs. 7 dias atrás.
 *  − Concorrência (10%) ....... YouTube (medido): canais diferentes entre os 50 vídeos mais vistos.
 *  + Seus testes no Meta (20%)  Meta/Cakto (medido): ROAS dos anúncios com a etiqueta ia-<slug>.
 *  + Ticket (7%), + Facilidade (6%), − Risco de política (7%) ... catálogo do sistema (referência).
 * Parte sem dado fica de fora (o peso é redistribuído) e o score é marcado como parcial.
 * É um indicador para priorizar testes — não previsão de vendas.
 */

export type RadarOrigin = "youtube" | "historico" | "meta" | "catalogo" | "sem_dados";

export const ORIGIN_LABEL: Record<RadarOrigin, string> = {
  youtube: "medido no YouTube",
  historico: "medido no histórico do radar",
  meta: "medido nos seus anúncios",
  catalogo: "catálogo do sistema",
  sem_dados: "sem dados",
};

export interface RadarComponent {
  key: "demanda" | "crescimento" | "concorrencia" | "meta" | "ticket" | "facilidade" | "risco";
  label: string;
  /** 0–100 (para concorrência e risco, maior = pior). */
  value: number | null;
  weight: number;
  inverse: boolean;
  origin: RadarOrigin;
  detail: string;
}

export interface RadarScore {
  total: number | null;
  partial: boolean;
  components: RadarComponent[];
}

export interface Growth {
  /** Variação relativa da demanda (0.3 = +30%). */
  pct: number | null;
  current: number | null;
  base: number | null;
  baseDate: string | null;
  /** Dias de histórico com medição válida deste subnicho. */
  days: number;
}

/** Em alta: crescimento ≥ 30% em 7 dias, demanda ≥ 1.000 views/dia e não puxada por 1 vídeo só. */
export const HOT = { minGrowth: 0.3, minViewsPerDay: 1000, maxTopVideoShare: 0.6 } as const;

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

/** Medição válida mais recente de cada slug. */
export function latestMeasures(history: RadarSnapshot[]): Map<string, { m: SubnicheMeasure; date: string; measuredAt: string }> {
  const out = new Map<string, { m: SubnicheMeasure; date: string; measuredAt: string }>();
  for (const s of [...history].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const m of s.items) if (!m.error) out.set(m.slug, { m, date: s.date, measuredAt: s.measuredAt });
  }
  return out;
}

/** Série diária (views/dia) de um slug, do mais antigo ao mais novo. */
export function seriesFor(slug: string, history: RadarSnapshot[]): Array<{ date: string; viewsPerDay: number; channels: number }> {
  return [...history]
    .sort((a, b) => a.date.localeCompare(b.date))
    .flatMap((s) => {
      const m = s.items.find((i) => i.slug === slug && !i.error);
      return m ? [{ date: s.date, viewsPerDay: m.viewsPerDay, channels: m.channels }] : [];
    });
}

/**
 * Crescimento semana a semana: última medição vs. a medição mais próxima de 7
 * dias antes dela (aceita de 6 a 9 dias). Sem base, pct = null.
 */
export function growthFor(slug: string, history: RadarSnapshot[]): Growth {
  const series = seriesFor(slug, history);
  const last = series.at(-1);
  if (!last) return { pct: null, current: null, base: null, baseDate: null, days: 0 };
  const target = addDays(last.date, -7);
  let base: (typeof series)[number] | null = null;
  for (const p of series) {
    const gap = diffDays(p.date, last.date);
    if (gap < 6 || gap > 9) continue;
    if (!base || Math.abs(diffDays(p.date, target)) < Math.abs(diffDays(base.date, target))) base = p;
  }
  const pct = base && base.viewsPerDay > 0 ? (last.viewsPerDay - base.viewsPerDay) / base.viewsPerDay : null;
  return { pct, current: last.viewsPerDay, base: base?.viewsPerDay ?? null, baseDate: base?.date ?? null, days: series.length };
}

export function isHot(m: SubnicheMeasure | null | undefined, g: Growth): boolean {
  if (!m || m.error || g.pct == null) return false;
  return g.pct >= HOT.minGrowth && m.viewsPerDay >= HOT.minViewsPerDay && (m.topVideoShare ?? 1) <= HOT.maxTopVideoShare;
}

/** Demanda 0–100: 100 views/dia = 0, 1 mil = 33, 10 mil = 67, 100 mil+ = 100. */
export function demandValue(viewsPerDay: number): number {
  if (viewsPerDay <= 0) return 0;
  return clamp(((Math.log10(viewsPerDay) - 2) / 3) * 100);
}

export function ticketValue(t: AiSubniche["ticket"]): number {
  const avg = (t.min + t.max) / 2;
  return clamp(((Math.log(avg) - Math.log(19)) / (Math.log(997) - Math.log(19))) * 100);
}

/** Gasto mínimo sem venda para o teste contar contra: 2× o ticket médio do catálogo. */
export function noSaleSpendLimit(t: AiSubniche["ticket"]): number {
  return 2 * ((t.min + t.max) / 2);
}

export function computeRadarScore(sub: AiSubniche, m: SubnicheMeasure | null, g: Growth, meta: MetaTest | null, measuredDate: string | null = null): RadarScore {
  const c: RadarComponent[] = [];
  const when = measuredDate ? ` (medição de ${measuredDate.split("-").reverse().join("/")})` : "";

  if (m && !m.error) {
    c.push({
      key: "demanda",
      label: "Demanda no YouTube",
      value: demandValue(m.viewsPerDay),
      weight: 0.3,
      inverse: false,
      origin: "youtube",
      detail: `${fmtCompact(m.viewsPerDay)} views/dia somando ${m.videos} vídeo(s) recentes sobre “${m.query}”${when}. Mediana por vídeo: ${fmtCompact(m.medianViewsPerDay)}/dia.${(m.topVideoShare ?? 0) > HOT.maxTopVideoShare ? ` Atenção: ${fmtPct(m.topVideoShare, 0)} vem de um único vídeo.` : ""}`,
    });
  } else {
    c.push({ key: "demanda", label: "Demanda no YouTube", value: null, weight: 0.3, inverse: false, origin: "sem_dados", detail: m?.error ?? "Ainda não medido. Clique em “Medir agora” (precisa da YOUTUBE_API_KEY)." });
  }

  if (g.pct != null) {
    c.push({
      key: "crescimento",
      label: "Crescimento em 7 dias",
      value: clamp(50 + g.pct * 100),
      weight: 0.2,
      inverse: false,
      origin: "historico",
      detail: `${g.pct >= 0 ? "+" : ""}${fmtPct(g.pct, 0)}: de ${fmtCompact(g.base)} para ${fmtCompact(g.current)} views/dia (base ${g.baseDate?.split("-").reverse().join("/")}).`,
    });
  } else {
    c.push({
      key: "crescimento",
      label: "Crescimento em 7 dias",
      value: null,
      weight: 0.2,
      inverse: false,
      origin: "sem_dados",
      detail: g.days ? `Precisa de uma medição de ~7 dias atrás (há ${g.days} dia(s) de histórico). O radar mede 1×/dia sozinho.` : "Sem histórico ainda.",
    });
  }

  if (m && !m.error && m.videos > 0) {
    c.push({
      key: "concorrencia",
      label: "Concorrência de criadores",
      value: clamp((m.channels / 50) * 100),
      weight: 0.1,
      inverse: true,
      origin: "youtube",
      detail: `${m.channels} canal(is) diferente(s) entre os ${m.videos} vídeos mais vistos; os 3 maiores somam ${fmtPct(m.top3Share, 0)} das views/dia. Muitos canais = tema disputado (e validado).`,
    });
  } else {
    c.push({ key: "concorrencia", label: "Concorrência de criadores", value: null, weight: 0.1, inverse: true, origin: "sem_dados", detail: "Sem vídeos medidos." });
  }

  c.push(metaComponent(sub, meta));

  c.push({ key: "ticket", label: "Ticket típico", value: ticketValue(sub.ticket), weight: 0.07, inverse: false, origin: "catalogo", detail: `Faixa comum R$ ${sub.ticket.min} a R$ ${sub.ticket.max} (referência, não medido).` });
  c.push({ key: "facilidade", label: "Facilidade de produzir", value: sub.ease, weight: 0.06, inverse: false, origin: "catalogo", detail: "Referência do sistema para criar o produto." });
  c.push({ key: "risco", label: "Risco de política do Meta", value: POLICY_RISK[sub.policy.level], weight: 0.07, inverse: true, origin: "catalogo", detail: sub.policy.reason ?? "Sem restrição específica conhecida para o tema." });

  const used = c.filter((x) => x.value != null);
  const wsum = used.reduce((a, x) => a + x.weight, 0);
  const total = wsum ? clamp(used.reduce((a, x) => a + x.weight * (x.inverse ? 100 - x.value! : x.value!), 0) / wsum) : null;
  return { total, partial: used.length < c.length, components: c };
}

function metaComponent(sub: AiSubniche, t: MetaTest | null): RadarComponent {
  const base = { key: "meta" as const, label: "Seus testes no Meta", weight: 0.2, inverse: false };
  if (!t || !t.ads.length) return { ...base, value: null, origin: "sem_dados", detail: `Nenhum anúncio com a etiqueta ia-${sub.slug} no nome (anúncio, conjunto ou campanha).` };
  const src = t.salesSource === "cakto" ? "vendas da Cakto" : t.salesSource === "meta" ? "compras do pixel" : "";
  if (t.purchases > 0) {
    return {
      ...base,
      value: clamp((t.roas ?? 0) * 50),
      origin: "meta",
      detail: `${t.ads.length} anúncio(s), ${fmtBRL(t.spend)} gastos, ${t.purchases} venda(s) (${src}), ROAS ${fmtRoas(t.roas)}. CPA ${fmtBRL(t.cpa)}${t.cpaLow != null ? ` (IC 95%: ${fmtBRL(t.cpaLow)} a ${t.cpaHigh != null ? fmtBRL(t.cpaHigh) : "∞"})` : ""}.${t.purchases < 3 ? " Poucas vendas: ainda pouco confiável." : ""}`,
    };
  }
  const limit = noSaleSpendLimit(sub.ticket);
  if (t.spend >= limit) {
    return { ...base, value: 10, origin: "meta", detail: `${fmtBRL(t.spend)} gastos sem venda (acima de 2× o ticket médio, ${fmtBRL(limit)}). CTR ${fmtPct(t.ctr, 2)}.` };
  }
  return { ...base, value: null, origin: "sem_dados", detail: `${t.ads.length} anúncio(s) com ${fmtBRL(t.spend)} gastos e nenhuma venda ainda — pouco para julgar (conta a partir de ${fmtBRL(limit)}). CTR ${fmtPct(t.ctr, 2)}.` };
}
