import "server-only";
import type { Repository } from "@/lib/data/repository";
import type { Ad, AdSet, Campaign, InsightDaily, Order, Product, TrackingHealth } from "@/lib/data/types";
import { configFromProduct, DEFAULT_DECISION_CONFIG, evaluate, type DecisionResult, type WindowData } from "@/lib/decision/rules";
import {
  aggregateInsights,
  aggregateOrders,
  computeDivergence,
  computeProfit,
  deriveMetrics,
  detectFatigue,
  type DerivedMetrics,
  type MetaTotals,
  type ProfitMetrics,
  type RealTotals,
} from "@/lib/metrics/compute";
import { addDays, dateIn, eachDay, todayIn, type Period } from "@/lib/tz";
import { groupBy, safeDiv } from "@/lib/utils";

const PAID = (o: Order) => o.status === "paid";

export interface Kpis {
  meta: MetaTotals;
  derived: DerivedMetrics;
  real: RealTotals;
  profit: ProfitMetrics;
}

function kpis(ins: InsightDaily[], orders: Order[], taxRate: number): Kpis {
  const meta = aggregateInsights(ins);
  const real = aggregateOrders(orders);
  return { meta, derived: deriveMetrics(meta), real, profit: computeProfit(meta.spend, real, taxRate) };
}

export interface Alert {
  severity: "critico" | "atencao" | "info";
  title: string;
  detail: string;
  href?: string;
}

// ------------------------------- Visão geral -------------------------------

export async function overview(repo: Repository, period: Period) {
  const ctx = await repo.context();
  const tax = ctx.workspace.taxRate;
  const [ins, prevIns, orders, prevOrders, health] = await Promise.all([
    repo.insights({ level: "account", from: period.from, to: period.to }),
    repo.insights({ level: "account", from: period.prevFrom, to: period.prevTo }),
    repo.orders({ from: period.from, to: period.to }),
    repo.orders({ from: period.prevFrom, to: period.prevTo }),
    repo.health(),
  ]);
  const cur = kpis(ins, orders, tax);
  const prev = kpis(prevIns, prevOrders, tax);
  const attributedPaid = orders.filter((o) => PAID(o) && o.attributionMethod !== "unattributed").length;
  const pendingPix = orders.filter((o) => o.status === "pending" && o.paymentMethod === "pix").length;
  const divergence = computeDivergence(cur.meta.purchases, attributedPaid, pendingPix);
  const rows = await campaignRows(repo, period, health);
  const alerts = buildAlerts(rows, health, divergence, cur);
  const daily = dailySeries(ins, orders, period, ctx.workspace.timezone, tax);
  return { ctx, cur, prev, divergence, alerts, health, daily, top: rows.filter((r) => r.periodSpend > 0).slice(0, 6) };
}

function buildAlerts(rows: CampaignRow[], health: TrackingHealth, div: ReturnType<typeof computeDivergence>, cur: Kpis): Alert[] {
  const alerts: Alert[] = [];
  for (const integ of health.integrations) {
    if (integ.provider === "anthropic") continue;
    if (integ.status === "error") alerts.push({ severity: "critico", title: `${integ.label}: problema`, detail: integ.detail, href: "/saude" });
    if (integ.status === "missing") alerts.push({ severity: "atencao", title: `${integ.label} não configurado`, detail: integ.detail, href: "/conexoes" });
    if (integ.status === "warning") alerts.push({ severity: "atencao", title: integ.label, detail: integ.detail, href: "/saude" });
  }
  if (cur.derived.connectRate != null && cur.meta.linkClicks > 100 && cur.derived.connectRate < 0.6) {
    alerts.push({
      severity: "critico",
      title: "Cliques sem visualização da página",
      detail: `Connect rate ${(cur.derived.connectRate * 100).toFixed(0)}%: página fora do ar, lenta ou redirecionando. Teste a URL no celular.`,
      href: "/saude",
    });
  }
  if (div.ratio != null && Math.abs(div.ratio) > 0.3 && div.realPurchases + div.metaPurchases >= 10) {
    alerts.push({ severity: "atencao", title: "Divergência Meta × Cakto", detail: div.explanation, href: "/saude" });
  }
  for (const r of rows) {
    if (r.decision.status === "pausar") {
      alerts.push({ severity: "critico", title: `Pausar? ${r.campaign.name}`, detail: r.decision.headline, href: `/campanhas/${r.campaign.id}` });
    }
    const freq = r.decision.signals.find((s) => s.code === "frequencia_alta");
    if (freq && r.campaign.effectiveStatus === "ACTIVE") {
      alerts.push({ severity: "atencao", title: `Frequência alta: ${r.campaign.name}`, detail: freq.message, href: `/campanhas/${r.campaign.id}` });
    }
  }
  const order = { critico: 0, atencao: 1, info: 2 };
  return alerts.sort((a, b) => order[a.severity] - order[b.severity]);
}

// ------------------------------- Série diária -------------------------------

export interface DailyPoint {
  date: string;
  spend: number;
  revenue: number;
  profit: number;
  purchases: number;
  metaPurchases: number;
  cumSpend: number;
  cumRevenue: number;
  cumProfit: number;
  cpa: number | null;
  roas: number | null;
  ctr: number | null;
  cpm: number | null;
  frequency: number | null;
}

/** Receita por dia usa a data de pagamento (fuso do workspace). */
export function dailySeries(ins: InsightDaily[], orders: Order[], period: Period, tz: string, taxRate: number): DailyPoint[] {
  const byDate = groupBy(ins, (r) => r.date);
  const paidByDate = groupBy(
    orders.filter(PAID),
    (o) => dateIn(new Date(o.paidAt ?? o.createdAt), tz),
  );
  let cumSpend = 0;
  let cumRevenue = 0;
  let cumProfit = 0;
  return eachDay(period.from, period.to).map((date) => {
    const t = aggregateInsights(byDate.get(date) ?? []);
    const d = deriveMetrics(t);
    const paid = paidByDate.get(date) ?? [];
    const revenue = round2(paid.reduce((s, o) => s + o.netAmount, 0));
    const profit = round2(revenue * (1 - taxRate) - t.spend);
    cumSpend += t.spend;
    cumRevenue += revenue;
    cumProfit += profit;
    return {
      date,
      spend: t.spend,
      revenue,
      profit,
      purchases: paid.length,
      metaPurchases: t.purchases,
      cumSpend: round2(cumSpend),
      cumRevenue: round2(cumRevenue),
      cumProfit: round2(cumProfit),
      cpa: safeDiv(t.spend, paid.length),
      roas: safeDiv(revenue, t.spend),
      ctr: d.ctrLink,
      cpm: d.cpm,
      frequency: d.frequency,
    };
  });
}

// ------------------------------- Gasto por dia -------------------------------

export interface SpendMatrix {
  dates: string[];
  entities: Array<{ id: string; name: string; total: number; byDate: Record<string, number> }>;
  totals: Record<string, number>;
  daily: DailyPoint[];
  grandTotal: number;
}

export async function spendByDay(
  repo: Repository,
  period: Period,
  filter: { level: "campaign" | "adset" | "ad"; campaignId?: string },
): Promise<SpendMatrix> {
  const ctx = await repo.context();
  const [ins, campaigns, adsets, ads, orders] = await Promise.all([
    repo.insights({ level: filter.level, from: period.from, to: period.to, campaignId: filter.campaignId }),
    repo.campaigns(),
    filter.level === "adset" ? repo.adsets(filter.campaignId) : Promise.resolve([] as AdSet[]),
    filter.level === "ad" ? repo.ads(filter.campaignId) : Promise.resolve([] as Ad[]),
    repo.orders({ from: period.from, to: period.to }),
  ]);
  const names = new Map<string, string>([
    ...campaigns.map((c) => [c.id, c.name] as const),
    ...adsets.map((a) => [a.id, a.name] as const),
    ...ads.map((a) => [a.id, a.name] as const),
  ]);
  const dates = eachDay(period.from, period.to);
  const byEntity = groupBy(ins, (r) => r.entityId);
  const entities = [...byEntity.entries()]
    .map(([id, rows]) => {
      const byDate: Record<string, number> = {};
      for (const r of rows) byDate[r.date] = round2((byDate[r.date] ?? 0) + r.spend);
      return { id, name: names.get(id) ?? id, total: round2(rows.reduce((s, r) => s + r.spend, 0)), byDate };
    })
    .filter((e) => e.total > 0)
    .sort((a, b) => b.total - a.total);
  const totals: Record<string, number> = {};
  for (const d of dates) totals[d] = round2(entities.reduce((s, e) => s + (e.byDate[d] ?? 0), 0));

  const relevantOrders = filter.campaignId ? orders.filter((o) => o.campaignId === filter.campaignId) : orders;
  const daily = dailySeries(ins, relevantOrders, period, ctx.workspace.timezone, ctx.workspace.taxRate);
  return { dates, entities, totals, daily, grandTotal: round2(entities.reduce((s, e) => s + e.total, 0)) };
}

// ------------------------------- Campanhas -------------------------------

export interface WindowSummary {
  spend: number;
  purchases: number;
  cpa: number | null;
  roas: number | null;
  ctr: number | null;
}

export interface CampaignRow {
  campaign: Campaign;
  product: Product | null;
  period: Kpis;
  periodSpend: number;
  w1: WindowSummary;
  w3: WindowSummary;
  w7: WindowSummary;
  decision: DecisionResult;
}

function windowData(ins: InsightDaily[], orders: Order[], from: string, to: string, tz: string): WindowData {
  const meta = aggregateInsights(ins.filter((r) => r.date >= from && r.date <= to));
  const paid = orders.filter((o) => {
    if (!PAID(o)) return false;
    const d = dateIn(new Date(o.paidAt ?? o.createdAt), tz);
    return d >= from && d <= to;
  });
  return { meta, realPurchases: paid.length, realNetRevenue: round2(paid.reduce((s, o) => s + o.netAmount, 0)) };
}

function summarize(w: WindowData): WindowSummary {
  const d = deriveMetrics(w.meta);
  return {
    spend: w.meta.spend,
    purchases: w.realPurchases,
    cpa: safeDiv(w.meta.spend, w.realPurchases),
    roas: safeDiv(w.realNetRevenue, w.meta.spend),
    ctr: d.ctrLink,
  };
}

export function trackingOk(health: TrackingHealth): boolean {
  const t = health.integrations.find((i) => i.provider === "tracking");
  const c = health.integrations.find((i) => i.provider === "cakto");
  return Boolean(t && c && t.status !== "error" && t.status !== "missing" && c.status !== "error" && c.status !== "missing");
}

export async function campaignRows(repo: Repository, period: Period, health?: TrackingHealth): Promise<CampaignRow[]> {
  const ctx = await repo.context();
  const tz = ctx.workspace.timezone;
  const today = todayIn(tz);
  const from = period.from < addDays(today, -6) ? period.from : addDays(today, -6);
  const to = period.to > today ? period.to : today;
  const [campaigns, products, ins, orders, adsets, h] = await Promise.all([
    repo.campaigns(),
    repo.products(),
    repo.insights({ level: "campaign", from, to }),
    repo.orders({ from: addDays(from, -1), to }),
    repo.adsets(),
    health ? Promise.resolve(health) : repo.health(),
  ]);
  const ok = trackingOk(h);
  const insBy = groupBy(ins, (r) => r.entityId);
  const ordersBy = groupBy(orders.filter((o) => o.campaignId), (o) => o.campaignId!);
  const learning = new Set(adsets.filter((a) => a.learningStage === "LEARNING").map((a) => a.campaignId));

  return campaigns
    .map((c) => {
      const cIns = insBy.get(c.id) ?? [];
      const cOrders = ordersBy.get(c.id) ?? [];
      const product = products.find((p) => p.id === c.productId) ?? null;
      const config = product ? configFromProduct(product) : DEFAULT_DECISION_CONFIG;
      const w1 = windowData(cIns, cOrders, today, today, tz);
      const w3 = windowData(cIns, cOrders, addDays(today, -2), today, tz);
      const w7 = windowData(cIns, cOrders, addDays(today, -6), today, tz);
      const periodIns = cIns.filter((r) => r.date >= period.from && r.date <= period.to);
      const periodOrders = cOrders.filter((o) => {
        const d = dateIn(new Date(o.paidAt ?? o.createdAt), tz);
        return d >= period.from && d <= period.to;
      });
      const pk = kpis(periodIns, periodOrders, ctx.workspace.taxRate);
      const decision =
        c.effectiveStatus === "ACTIVE"
          ? evaluate({ last1d: w1, last3d: w3, last7d: w7, trackingOk: ok, learningPhase: learning.has(c.id), config })
          : {
              status: "manter" as const,
              confidence: "baixa" as const,
              signals: [],
              missingData: null,
              headline: "Campanha pausada.",
            };
      return { campaign: c, product, period: pk, periodSpend: pk.meta.spend, w1: summarize(w1), w3: summarize(w3), w7: summarize(w7), decision };
    })
    .sort((a, b) => b.periodSpend - a.periodSpend || Number(b.campaign.effectiveStatus === "ACTIVE") - Number(a.campaign.effectiveStatus === "ACTIVE"));
}

// ------------------------------- Página da campanha -------------------------------

export interface EntityPerf {
  id: string;
  name: string;
  status: string;
  meta: MetaTotals;
  derived: DerivedMetrics;
  realPurchases: number;
  realRevenue: number;
  cpaReal: number | null;
  roasReal: number | null;
}

export interface AdPerf extends EntityPerf {
  ad: Ad;
  fatigue: ReturnType<typeof detectFatigue>;
  rankings: { quality: string | null; engagement: string | null; conversion: string | null };
}

function perf(id: string, name: string, status: string, ins: InsightDaily[], orders: Order[]): EntityPerf {
  const meta = aggregateInsights(ins);
  const paid = orders.filter(PAID);
  const realRevenue = round2(paid.reduce((s, o) => s + o.netAmount, 0));
  return {
    id,
    name,
    status,
    meta,
    derived: deriveMetrics(meta),
    realPurchases: paid.length,
    realRevenue,
    cpaReal: safeDiv(meta.spend, paid.length),
    roasReal: safeDiv(realRevenue, meta.spend),
  };
}

export async function campaignDetail(repo: Repository, campaignId: string, period: Period) {
  const ctx = await repo.context();
  const tz = ctx.workspace.timezone;
  const campaigns = await repo.campaigns();
  const campaign = campaigns.find((c) => c.id === campaignId);
  if (!campaign) return null;

  const [cIns, adsetIns, adIns, adsets, ads, ordersAll, notes, rows] = await Promise.all([
    repo.insights({ level: "campaign", from: period.from, to: period.to, campaignId }),
    repo.insights({ level: "adset", from: period.from, to: period.to, campaignId }),
    // Anúncios: pelo menos 30 dias para detectar fadiga (início vs. fim da veiculação)
    repo.insights({ level: "ad", from: addDays(period.to, -29) < period.from ? addDays(period.to, -29) : period.from, to: period.to, campaignId }),
    repo.adsets(campaignId),
    repo.ads(campaignId),
    repo.orders({ from: period.from, to: period.to }),
    repo.notes(campaignId),
    campaignRows(repo, period),
  ]);
  const orders = ordersAll.filter((o) => o.campaignId === campaignId);
  const row = rows.find((r) => r.campaign.id === campaignId)!;
  const k = kpis(cIns, orders, ctx.workspace.taxRate);

  const generated = orders.filter((o) => o.status !== "abandoned" && o.status !== "unknown").length;
  const funnel = [
    { key: "impressions", label: "Impressões", value: k.meta.impressions, source: "Meta" },
    { key: "linkClicks", label: "Cliques no link", value: k.meta.linkClicks, source: "Meta" },
    { key: "lpv", label: "Visualizações da página", value: k.meta.landingPageViews, source: "Meta" },
    { key: "ic", label: "Início de checkout", value: k.meta.initiateCheckout, source: "Meta" },
    { key: "generated", label: "Pedido gerado", value: generated, source: "Cakto" },
    { key: "paid", label: "Pago", value: k.real.paidOrders, source: "Cakto" },
  ].map((step, i, arr) => ({ ...step, rate: i === 0 ? null : safeDiv(step.value, arr[i - 1].value) }));

  // Etapa com a pior taxa de passagem relativa a uma referência saudável
  const BENCH: Record<string, number> = { linkClicks: 0.012, lpv: 0.75, ic: 0.08, generated: 0.5, paid: 0.6 };
  let leak: { key: string; label: string; rate: number; bench: number } | null = null;
  for (const s of funnel.slice(1)) {
    if (s.rate == null || !BENCH[s.key]) continue;
    const ratio = s.rate / BENCH[s.key];
    if (ratio < 1 && (!leak || ratio < leak.rate / leak.bench)) leak = { key: s.key, label: s.label, rate: s.rate, bench: BENCH[s.key] };
  }

  const timeline = dailySeries(cIns, orders, period, tz, ctx.workspace.taxRate);

  const adsetPerf = adsets.map((a) =>
    perf(a.id, a.name, a.effectiveStatus, adsetIns.filter((r) => r.entityId === a.id), orders.filter((o) => o.adsetId === a.id)),
  );
  const adsetMeta = new Map(adsets.map((a) => [a.id, a]));

  const adPerf: AdPerf[] = ads.map((ad) => {
    const all = adIns.filter((r) => r.entityId === ad.id);
    const inPeriod = all.filter((r) => r.date >= period.from && r.date <= period.to);
    const latest = [...all].sort((a, b) => b.date.localeCompare(a.date)).find((r) => r.qualityRanking || r.engagementRanking);
    return {
      ...perf(ad.id, ad.name, ad.effectiveStatus, inPeriod, orders.filter((o) => o.adId === ad.id)),
      ad,
      fatigue: detectFatigue(all),
      rankings: {
        quality: latest?.qualityRanking ?? null,
        engagement: latest?.engagementRanking ?? null,
        conversion: latest?.conversionRanking ?? null,
      },
    };
  });

  const markers = [
    ...notes.map((n) => ({ date: n.date, label: n.text, kind: "nota" as const })),
    ...ads
      .filter((a) => a.createdTime && dateIn(new Date(a.createdTime), tz) >= period.from)
      .map((a) => ({ date: dateIn(new Date(a.createdTime!), tz), label: `Novo anúncio: ${a.name}`, kind: "criativo" as const })),
  ];

  return { ctx, campaign, row, k, funnel, leak, timeline, adsetPerf, adsetMeta, adPerf, notes, markers, orders };
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}
