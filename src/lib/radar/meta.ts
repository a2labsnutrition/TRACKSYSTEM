import type { Ad, AdSet, Campaign, InsightDaily, Order } from "@/lib/data/types";
import { orderParts } from "@/lib/data/types";
import { slugPart } from "@/lib/discover/structure";
import { cpaInterval } from "@/lib/stats/core";
import { safeDiv } from "@/lib/utils";

/**
 * Resultados dos SEUS testes no Meta por subnicho. A ligação é pela etiqueta
 * `ia-<slug>` no nome do anúncio (ou, se não tiver, do conjunto ou da campanha).
 * Aceita as formas:
 *  - `ia-chatgpt-iniciantes` (com hífens, como no catálogo, em qualquer lugar do nome);
 *  - `iaChatgptIniciantes` (como a fila de Criativos nomeia os anúncios: [produto]_ângulo_público_cNN).
 * Se dois slugs servirem (ex.: `ia-chatgpt` e `ia-chatgpt-iniciantes`), vale o mais longo.
 */

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Formas normalizadas (só letras e números) aceitas para o slug. */
export function tagKeys(slug: string): string[] {
  const full = `ia${slug.replace(/[^a-z0-9]/g, "")}`;
  const short = slugPart(`ia-${slug}`).toLowerCase();
  return [...new Set([full, short])];
}

/** Slug do subnicho cuja etiqueta aparece em `name` (ou null). */
export function findTag(name: string | null | undefined, slugs: string[]): string | null {
  if (!name) return null;
  const candidates = new Set<string>();
  for (const token of norm(name).split(/[^a-z0-9-]+/).filter(Boolean)) {
    const parts = token.split("-").filter(Boolean);
    for (let i = 0; i < parts.length; i++) {
      if (!parts[i].startsWith("ia")) continue;
      let acc = "";
      for (let j = i; j < parts.length; j++) {
        acc += parts[j];
        candidates.add(acc);
      }
    }
  }
  if (!candidates.size) return null;
  let best: string | null = null;
  for (const slug of slugs) {
    if (tagKeys(slug).some((k) => candidates.has(k)) && (!best || slug.length > best.length)) best = slug;
  }
  return best;
}

export interface MetaTest {
  slug: string;
  ads: Array<{ id: string; name: string; campaignId: string; via: "anuncio" | "conjunto" | "campanha" }>;
  spend: number;
  impressions: number;
  linkClicks: number;
  ctr: number | null;
  /** Compras que o Meta atribuiu (pixel/CAPI). */
  metaPurchases: number;
  metaRevenue: number;
  /** Vendas principais pagas na Cakto ligadas a esses anúncios. */
  realSales: number;
  realRevenue: number;
  /** Vendas usadas nos cálculos: Cakto quando houver, senão Meta. */
  purchases: number;
  revenue: number;
  salesSource: "cakto" | "meta" | null;
  cpa: number | null;
  roas: number | null;
  cpaLow: number | null;
  cpaHigh: number | null;
  /** Linhas ignoradas por falta de cotação (conta em moeda estrangeira). */
  fxMissingRows: number;
  days: number;
}

/** Agrupa anúncios, insights (nível anúncio) e pedidos por subnicho. */
export function metaTestsBySlug(input: {
  slugs: string[];
  ads: Ad[];
  adsets: AdSet[];
  campaigns: Campaign[];
  insights: InsightDaily[];
  orders: Order[];
}): Map<string, MetaTest> {
  const adsetName = new Map(input.adsets.map((a) => [a.id, a.name]));
  const campaignName = new Map(input.campaigns.map((c) => [c.id, c.name]));
  const slugOfAd = new Map<string, string>();
  const out = new Map<string, MetaTest>();
  const get = (slug: string): MetaTest => {
    let t = out.get(slug);
    if (!t) {
      t = { slug, ads: [], spend: 0, impressions: 0, linkClicks: 0, ctr: null, metaPurchases: 0, metaRevenue: 0, realSales: 0, realRevenue: 0, purchases: 0, revenue: 0, salesSource: null, cpa: null, roas: null, cpaLow: null, cpaHigh: null, fxMissingRows: 0, days: 0 };
      out.set(slug, t);
    }
    return t;
  };

  for (const ad of input.ads) {
    let via: MetaTest["ads"][number]["via"] = "anuncio";
    let slug = findTag(ad.name, input.slugs);
    if (!slug) {
      slug = findTag(adsetName.get(ad.adsetId), input.slugs);
      via = "conjunto";
    }
    if (!slug) {
      slug = findTag(campaignName.get(ad.campaignId), input.slugs);
      via = "campanha";
    }
    if (!slug) continue;
    slugOfAd.set(ad.id, slug);
    get(slug).ads.push({ id: ad.id, name: ad.name, campaignId: ad.campaignId, via });
  }

  const days = new Map<string, Set<string>>();
  for (const r of input.insights) {
    if (r.level !== "ad") continue;
    const slug = slugOfAd.get(r.entityId);
    if (!slug) continue;
    const t = get(slug);
    if (r.fxMissing) {
      t.fxMissingRows++;
      continue;
    }
    t.spend += r.spend;
    t.impressions += r.impressions;
    t.linkClicks += r.linkClicks;
    t.metaPurchases += r.purchases;
    t.metaRevenue += r.purchaseValue;
    if (!days.has(slug)) days.set(slug, new Set());
    days.get(slug)!.add(r.date);
  }

  for (const o of input.orders) {
    if (o.status !== "paid" || !o.adId) continue;
    const slug = slugOfAd.get(o.adId);
    if (!slug || orderParts(o).kind !== "main") continue;
    const t = get(slug);
    t.realSales++;
    t.realRevenue += o.grossAmount;
  }

  for (const t of out.values()) {
    t.spend = Math.round(t.spend * 100) / 100;
    t.days = days.get(t.slug)?.size ?? 0;
    t.ctr = safeDiv(t.linkClicks, t.impressions);
    if (t.realSales > 0) {
      t.purchases = t.realSales;
      t.revenue = t.realRevenue;
      t.salesSource = "cakto";
    } else if (t.metaPurchases > 0) {
      t.purchases = t.metaPurchases;
      t.revenue = t.metaRevenue;
      t.salesSource = "meta";
    }
    t.cpa = t.purchases > 0 ? safeDiv(t.spend, t.purchases) : null;
    t.roas = t.spend > 0 ? t.revenue / t.spend : null;
    if (t.spend > 0) {
      const ci = cpaInterval(t.spend, t.purchases);
      t.cpaLow = ci.lower;
      t.cpaHigh = ci.upper;
    }
  }
  return out;
}
