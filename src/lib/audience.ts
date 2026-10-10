import type { BreakdownKey, BreakdownRow, InsightDaily } from "@/lib/data/types";
import { fmtBRL, fmtPct } from "@/lib/format";
import { breakdownLabel } from "@/lib/integrations/meta/breakdowns";
import { safeDiv } from "@/lib/utils";

/**
 * Análise de públicos: onde converte barato e onde queima dinheiro.
 * Compras aqui são as do Meta — a Cakto não informa idade/gênero/posicionamento.
 */

export type AudienceTab = "age" | "gender" | "age_gender" | "placement" | "device" | "region" | "hour" | "weekday";

export const AUDIENCE_TABS: Array<{ key: AudienceTab; label: string }> = [
  { key: "age", label: "Idade" },
  { key: "gender", label: "Gênero" },
  { key: "age_gender", label: "Idade + gênero" },
  { key: "placement", label: "Posicionamento" },
  { key: "device", label: "Dispositivo" },
  { key: "region", label: "Região" },
  { key: "hour", label: "Horário" },
  { key: "weekday", label: "Dia da semana" },
];

export type SegmentTag = "barato" | "caro" | "queima" | null;

export interface Segment {
  value: string;
  label: string;
  spend: number;
  spendShare: number | null;
  impressions: number;
  linkClicks: number;
  landingPageViews: number;
  purchases: number;
  purchaseShare: number | null;
  cpa: number | null;
  ctr: number | null;
  cpm: number | null;
  connectRate: number | null;
  tag: SegmentTag;
}

export interface AudienceTable {
  tab: AudienceTab;
  segments: Segment[];
  avgCpa: number | null;
  totalSpend: number;
  totalPurchases: number;
}

interface Agg {
  spend: number;
  impressions: number;
  linkClicks: number;
  landingPageViews: number;
  purchases: number;
}

function add(a: Agg, r: Agg) {
  a.spend += r.spend;
  a.impressions += r.impressions;
  a.linkClicks += r.linkClicks;
  a.landingPageViews += r.landingPageViews;
  a.purchases += r.purchases;
}

function keyFor(tab: AudienceTab, r: BreakdownRow): string | null {
  if (tab === "age" || tab === "gender") {
    if (r.breakdown !== "age_gender") return null;
    const [age, gender] = r.value.split("|");
    return tab === "age" ? age : gender;
  }
  return r.breakdown === (tab as BreakdownKey) ? r.value : null;
}

export function buildTable(tab: AudienceTab, aggs: Map<string, Agg>, targetCpa: number): AudienceTable {
  const totalSpend = [...aggs.values()].reduce((s, a) => s + a.spend, 0);
  const totalPurchases = [...aggs.values()].reduce((s, a) => s + a.purchases, 0);
  const avgCpa = safeDiv(totalSpend, totalPurchases);
  const burnThreshold = Math.max(targetCpa, avgCpa ?? 0);
  const segments: Segment[] = [...aggs.entries()].map(([value, a]) => {
    const cpa = safeDiv(a.spend, a.purchases);
    const spendShare = safeDiv(a.spend, totalSpend);
    let tag: SegmentTag = null;
    if (a.purchases === 0 && a.spend >= burnThreshold && (spendShare ?? 0) >= 0.03) tag = "queima";
    else if (avgCpa && cpa != null && a.purchases >= 2 && cpa <= avgCpa * 0.8) tag = "barato";
    else if (avgCpa && cpa != null && a.purchases >= 1 && cpa >= avgCpa * 1.3 && (spendShare ?? 0) >= 0.03) tag = "caro";
    return {
      value,
      label: breakdownLabel(tab === "weekday" ? "weekday" : (tab as BreakdownKey), value),
      spend: Math.round(a.spend * 100) / 100,
      spendShare,
      impressions: a.impressions,
      linkClicks: a.linkClicks,
      landingPageViews: a.landingPageViews,
      purchases: a.purchases,
      purchaseShare: safeDiv(a.purchases, totalPurchases),
      cpa,
      ctr: safeDiv(a.linkClicks, a.impressions),
      cpm: a.impressions ? (a.spend / a.impressions) * 1000 : null,
      connectRate: safeDiv(a.landingPageViews, a.linkClicks),
      tag,
    };
  });
  const order = tab === "hour" || tab === "weekday";
  segments.sort((x, y) => (order ? x.value.localeCompare(y.value) : y.spend - x.spend));
  return { tab, segments, avgCpa, totalSpend, totalPurchases };
}

export function analyzeAudience(breakdowns: BreakdownRow[], campaignDaily: InsightDaily[], targetCpa: number): AudienceTable[] {
  const tables: AudienceTable[] = [];
  for (const { key } of AUDIENCE_TABS) {
    const aggs = new Map<string, Agg>();
    if (key === "weekday") {
      for (const r of campaignDaily) {
        const [y, m, d] = r.date.split("-").map(Number);
        const wd = String(new Date(Date.UTC(y, m - 1, d)).getUTCDay());
        const a = aggs.get(wd) ?? { spend: 0, impressions: 0, linkClicks: 0, landingPageViews: 0, purchases: 0 };
        add(a, r);
        aggs.set(wd, a);
      }
    } else {
      for (const r of breakdowns) {
        const k = keyFor(key, r);
        if (k == null) continue;
        const a = aggs.get(k) ?? { spend: 0, impressions: 0, linkClicks: 0, landingPageViews: 0, purchases: 0 };
        add(a, r);
        aggs.set(k, a);
      }
    }
    tables.push(buildTable(key, aggs, targetCpa));
  }
  return tables;
}

/** Frases curtas com os achados (para a tela e para o Parecer da IA). */
export function audienceHighlights(tables: AudienceTable[], max = 6): string[] {
  const tabLabel = new Map(AUDIENCE_TABS.map((t) => [t.key, t.label]));
  const out: Array<{ score: number; text: string }> = [];
  for (const t of tables) {
    if (t.tab === "age" || t.tab === "gender") continue; // cobertos por idade+gênero
    for (const s of t.segments) {
      if (s.tag === "barato" && t.avgCpa && s.cpa) {
        out.push({
          score: (s.spendShare ?? 0) * (1 - s.cpa / t.avgCpa),
          text: `${tabLabel.get(t.tab)}: ${s.label} converte barato — CPA ${fmtBRL(s.cpa)} (${fmtPct(s.cpa / t.avgCpa - 1, 0)} vs. média ${fmtBRL(t.avgCpa)}), ${fmtPct(s.spendShare, 0)} do gasto.`,
        });
      } else if (s.tag === "queima") {
        out.push({
          score: (s.spendShare ?? 0) * 1.5,
          text: `${tabLabel.get(t.tab)}: ${s.label} queima dinheiro — ${fmtBRL(s.spend)} (${fmtPct(s.spendShare, 0)} do gasto) sem compra.`,
        });
      } else if (s.tag === "caro" && t.avgCpa && s.cpa) {
        out.push({
          score: (s.spendShare ?? 0) * (s.cpa / t.avgCpa - 1) * 0.8,
          text: `${tabLabel.get(t.tab)}: ${s.label} está caro — CPA ${fmtBRL(s.cpa)} (${fmtPct(s.cpa / t.avgCpa - 1, 0)} acima da média), ${fmtPct(s.spendShare, 0)} do gasto.`,
        });
      }
    }
  }
  return out
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.text);
}
