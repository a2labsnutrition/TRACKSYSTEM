import "server-only";
import type { Repository } from "@/lib/data/repository";
import type { Ad, AdSet, Campaign, InsightDaily, Order, Product, TrackingHealth } from "@/lib/data/types";
import { configFromProduct, DEFAULT_DECISION_CONFIG, evaluate, type DecisionConfig, type DecisionResult, type WindowData } from "@/lib/decision/rules";
import {
  aggregateInsights,
  aggregateOrders,
  computeDivergence,
  computePacing,
  computeProfit,
  deriveMetrics,
  detectFatigue,
  type DerivedMetrics,
  type MetaTotals,
  type ProfitMetrics,
  type RealTotals,
} from "@/lib/metrics/compute";
import { computeAlerts } from "@/lib/alerts/engine";
import { analyzeAudience, audienceHighlights } from "@/lib/audience";
import { addDays, dateIn, eachDay, hourIn, todayIn, type Period } from "@/lib/tz";
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
  const [rows, ads] = await Promise.all([campaignRows(repo, period, health), repo.ads()]);
  const tzAcc = ctx.adAccounts[0]?.timezone ?? ctx.workspace.timezone;
  const now = new Date();
  const alerts: Alert[] = computeAlerts({
    campaigns: rows.map((r) => ({
      id: r.campaign.id,
      name: r.campaign.name,
      active: r.campaign.effectiveStatus === "ACTIVE",
      dailyBudget: r.campaign.dailyBudget,
      spendToday: r.w1.spend,
      spend3d: r.w3.spend,
      signals: r.decision.signals,
    })),
    ads: ads.map((a) => ({ id: a.id, name: a.name, campaignId: a.campaignId, effectiveStatus: a.effectiveStatus })),
    accounts: ctx.adAccounts.map((a) => ({ id: a.id, name: a.name, status: a.status })),
    health,
    dayElapsed: (hourIn(now, tzAcc) * 60 + now.getUTCMinutes()) / 1440,
  }).map((a) => ({ severity: a.severity, title: a.title, detail: a.message, href: a.href ?? undefined }));
  if (divergence.ratio != null && Math.abs(divergence.ratio) > 0.3 && divergence.realPurchases + divergence.metaPurchases >= 10) {
    alerts.push({ severity: "atencao", title: "Divergência Meta × Cakto", detail: divergence.explanation, href: "/saude" });
  }
  const daily = dailySeries(ins, orders, period, ctx.workspace.timezone, tax);
  return { ctx, cur, prev, divergence, alerts, health, daily, top: rows.filter((r) => r.periodSpend > 0).slice(0, 6) };
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
  config: DecisionConfig;
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
  const [campaigns, products, ins, orders, adsets, h, adIns, ads] = await Promise.all([
    repo.campaigns(),
    repo.products(),
    repo.insights({ level: "campaign", from: from < addDays(today, -6) ? from : addDays(today, -6), to }),
    repo.orders({ from: addDays(from, -1), to }),
    repo.adsets(),
    health ? Promise.resolve(health) : repo.health(),
    // Anúncios dos últimos 21 dias: fadiga compara início x fim da veiculação
    repo.insights({ level: "ad", from: addDays(today, -20), to: today }),
    repo.ads(),
  ]);
  const ok = trackingOk(h);
  const insBy = groupBy(ins, (r) => r.entityId);
  const ordersBy = groupBy(orders.filter((o) => o.campaignId), (o) => o.campaignId!);
  const learning = new Set(adsets.filter((a) => a.learningStage === "LEARNING").map((a) => a.campaignId));
  const adInsBy = groupBy(adIns, (r) => r.entityId);
  const adName = new Map(ads.map((a) => [a.id, a.name]));
  const adsByCampaign = groupBy(ads, (a) => a.campaignId);
  const fatigueFor = (campaignId: string) => {
    const active = (adsByCampaign.get(campaignId) ?? []).filter((a) => {
      const rows = adInsBy.get(a.id) ?? [];
      return a.effectiveStatus === "ACTIVE" && rows.some((r) => r.date >= addDays(today, -6) && r.spend > 0);
    });
    const fatigued = active.filter((a) => detectFatigue(adInsBy.get(a.id) ?? []).fatigued).map((a) => adName.get(a.id) ?? a.id);
    return { activeAds: active.length, fatiguedAds: fatigued };
  };

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
          ? evaluate({
              last1d: w1,
              last3d: w3,
              last7d: w7,
              prev4d: windowData(cIns, cOrders, addDays(today, -6), addDays(today, -3), tz),
              trackingOk: ok,
              learningPhase: learning.has(c.id),
              config,
              ...fatigueFor(c.id),
            })
          : {
              status: "manter" as const,
              confidence: "baixa" as const,
              signals: [],
              missingData: null,
              headline: "Campanha pausada.",
            };
      return { campaign: c, product, config, period: pk, periodSpend: pk.meta.spend, w1: summarize(w1), w3: summarize(w3), w7: summarize(w7), decision };
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

  const [cIns, adsetIns, adIns, adsets, ads, ordersAll, notes, rows, breakdowns, events, todayCampaign] = await Promise.all([
    repo.insights({ level: "campaign", from: period.from, to: period.to, campaignId }),
    repo.insights({ level: "adset", from: period.from, to: period.to, campaignId }),
    // Anúncios: pelo menos 30 dias para detectar fadiga (início vs. fim da veiculação)
    repo.insights({ level: "ad", from: addDays(period.to, -29) < period.from ? addDays(period.to, -29) : period.from, to: period.to, campaignId }),
    repo.adsets(campaignId),
    repo.ads(campaignId),
    repo.orders({ from: period.from, to: period.to }),
    repo.notes(campaignId),
    campaignRows(repo, period),
    repo.breakdowns({ campaignId, from: period.from, to: period.to }),
    repo.entityEvents({ campaignId, from: period.from, to: period.to }),
    repo.insights({ level: "campaign", from: todayIn(tz), to: todayIn(tz), campaignId }),
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
  const BENCH: Record<string, number> = { linkClicks: 0.01, lpv: 0.75, ic: 0.08, generated: 0.35, paid: 0.6 };
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

  const markerKind = (t: string): "orcamento" | "criativo" | "aprendizado" | "nota" =>
    /budget/.test(t) ? "orcamento" : /learning/.test(t) ? "aprendizado" : /create_ad$|creative/.test(t) ? "criativo" : "nota";
  const eventAdIds = new Set(events.filter((e) => e.adId).map((e) => e.adId));
  const markers = [
    ...notes.map((n) => ({ date: n.date, label: n.text, kind: "nota" as const })),
    ...events.map((e) => ({ date: dateIn(new Date(e.eventTime), tz), label: e.label, kind: markerKind(e.eventType) })),
    // Anúncios novos que não vieram pelas atividades do Meta
    ...ads
      .filter((a) => a.createdTime && !eventAdIds.has(a.id) && dateIn(new Date(a.createdTime), tz) >= period.from)
      .map((a) => ({ date: dateIn(new Date(a.createdTime!), tz), label: `Novo anúncio: ${a.name}`, kind: "criativo" as const })),
  ].sort((a, b) => a.date.localeCompare(b.date));

  // ---- Pacing de hoje ----
  const dailyBudget =
    campaign.dailyBudget ?? (adsets.filter((a) => a.effectiveStatus === "ACTIVE").reduce((s, a) => s + (a.dailyBudget ?? 0), 0) || null);
  const now = new Date();
  const accountTz = ctx.adAccounts.find((a) => a.id === campaign.adAccountId)?.timezone ?? tz;
  const pacing = dailyBudget
    ? computePacing(todayCampaign.reduce((s, r) => s + r.spend, 0), dailyBudget, hourIn(now, accountTz), now.getUTCMinutes())
    : null;

  // ---- Públicos ----
  const audience = analyzeAudience(breakdowns, cIns, row.config.targetCpa);
  const highlights = audienceHighlights(audience);

  return { ctx, campaign, row, k, funnel, leak, timeline, adsetPerf, adsetMeta, adPerf, notes, markers, orders, pacing, audience, highlights, hasBreakdowns: breakdowns.length > 0 };
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}
