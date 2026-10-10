import "server-only";
import type { Repository } from "@/lib/data/repository";
import { orderParts, type Ad, type AdSet, type Campaign, type InsightDaily, type Order, type Product, type TrackingHealth, type Workspace } from "@/lib/data/types";
import {
  configFromProduct,
  DEFAULT_DECISION_CONFIG,
  evaluate,
  inactiveDecision,
  type DecisionConfig,
  type DecisionResult,
  type Recommendation,
  type WindowData,
} from "@/lib/decision/rules";
import {
  aggregateInsights,
  aggregateOrders,
  computeDivergence,
  computePacing,
  deriveMetrics,
  detectFatigue,
  type DerivedMetrics,
  type MetaTotals,
  type ProfitMetrics,
  type RealTotals,
} from "@/lib/metrics/compute";
import { computeFinancials, type CostSettings, type Financials } from "@/lib/metrics/finance";
import { attributionLevel } from "@/lib/attribution/attribute";
import { analyzeCreatives, type CreativeReport } from "@/lib/creative/intelligence";
import { detectAnomalies, type AnomalyDay } from "@/lib/anomalies";
import { computeAlerts } from "@/lib/alerts/engine";
import { analyzeAudience, audienceHighlights } from "@/lib/audience";
import { addDays, dateIn, eachDay, hourIn, todayIn, type Period } from "@/lib/tz";
import { groupBy, safeDiv } from "@/lib/utils";

const PAID = (o: Order) => o.status === "paid";
const isMain = (o: Order) => orderParts(o).kind === "main";
const MAIN_PAID = (o: Order) => PAID(o) && isMain(o);
const paidDate = (o: Order, tz: string) => dateIn(new Date(o.paidAt ?? o.createdAt), tz);

/** Venda sem campanha identificada que PODE ter vindo do Meta (UTM de outra origem fica de fora). */
const NON_META_SOURCE = /google|tiktok|youtube|email|e-mail|whats|organic|organico|orgânico|bio|kwai|pinterest|bing/i;
export function couldBeMeta(o: Order): boolean {
  return !o.campaignId && !(o.utmSource && NON_META_SOURCE.test(o.utmSource));
}

// ------------------------------- Atribuição -------------------------------

export interface AttributionSplit {
  confirmada: number;
  provavel: number;
  desconhecida: number;
  total: number;
  /** Fração com origem confirmada ou provável (null = sem vendas). */
  coverage: number | null;
}

/** Compras PRINCIPAIS pagas por nível de atribuição. */
export function attributionSplit(orders: Order[]): AttributionSplit {
  const s = { confirmada: 0, provavel: 0, desconhecida: 0, total: 0 };
  for (const o of orders) {
    if (!MAIN_PAID(o)) continue;
    s.total++;
    s[attributionLevel(o.attributionMethod)]++;
  }
  return { ...s, coverage: s.total ? (s.confirmada + s.provavel) / s.total : null };
}

// ------------------------------- KPIs -------------------------------

export interface FxStatus {
  /** Algum gasto foi convertido de outra moeda (estimado). */
  estimated: boolean;
  /** Algum gasto ficou sem cotação e foi EXCLUÍDO das somas. */
  missing: boolean;
  currencies: string[];
  /** Gasto excluído, na moeda original. */
  missingOriginal: number;
}

export interface Kpis {
  meta: MetaTotals;
  derived: DerivedMetrics;
  real: RealTotals;
  profit: ProfitMetrics;
  fin: Financials;
  attribution: AttributionSplit;
  fx: FxStatus;
}

export function costSettings(ws: Pick<Workspace, "taxRate">, products: Product[]): CostSettings {
  return { taxRate: ws.taxRate, products: new Map(products.map((p) => [p.id, { costPerSale: p.costPerSale, costPct: p.costPct }])) };
}

export function fxStatus(ins: InsightDaily[]): FxStatus {
  const currencies = [...new Set(ins.map((r) => (r.currency ?? "BRL").toUpperCase()))];
  const missingRows = ins.filter((r) => r.fxMissing);
  return {
    estimated: ins.some((r) => r.fxEstimated && !r.fxMissing),
    missing: missingRows.length > 0,
    currencies,
    missingOriginal: round2(missingRows.reduce((s, r) => s + (r.spendOriginal ?? r.spend), 0)),
  };
}

export function fxIssues(fx: FxStatus): string[] {
  return fx.missing
    ? [`Gasto em ${fx.currencies.filter((c) => c !== "BRL").join("/")} sem cotação (${fmtNum(fx.missingOriginal)} na moeda da conta) foi excluído: resultado financeiro incompleto. Configure o câmbio da conta.`]
    : [];
}

/** Linhas sem cotação ficam FORA das somas (nunca somamos US$ como R$). */
const convertible = (ins: InsightDaily[]) => ins.filter((r) => !r.fxMissing);

export function kpis(ins: InsightDaily[], orders: Order[], costs: CostSettings): Kpis {
  const fx = fxStatus(ins);
  const meta = aggregateInsights(convertible(ins));
  const real = aggregateOrders(orders);
  const fin = computeFinancials(orders, meta.spend, costs, { spendEstimated: fx.estimated });
  if (fx.missing) fin.notes.unshift(fxIssues(fx)[0]);
  const profit: ProfitMetrics = {
    netRevenue: round2(fin.revenueAfterRefunds - fin.fees),
    taxes: fin.taxes,
    profit: fin.contribution,
    roasReal: fin.roasGross,
    cpaReal: fin.cpa,
    roi: safeDiv(fin.contribution, fin.adSpend),
    margin: fin.contributionMargin,
  };
  return { meta, derived: deriveMetrics(meta), real, profit, fin, attribution: attributionSplit(orders), fx };
}

export interface Alert {
  severity: "critico" | "atencao" | "info";
  title: string;
  detail: string;
  href?: string;
}

export interface PrioritizedRecommendation extends Recommendation {
  campaignId: string;
  campaignName: string;
}

export interface Freshness {
  label: string;
  at: string | null;
  status: "ok" | "atrasado" | "sem_dados";
  rule: string;
}

// ------------------------------- Visão geral -------------------------------

export async function overview(repo: Repository, period: Period) {
  const ctx = await repo.context();
  const tz = ctx.workspace.timezone;
  const today = todayIn(tz);
  const lastFullDay = addDays(today, -1);
  const [ins, prevIns, orders, prevOrders, health, products, anomalyIns, anomalyOrders] = await Promise.all([
    repo.insights({ level: "account", from: period.from, to: period.to }),
    repo.insights({ level: "account", from: period.prevFrom, to: period.prevTo }),
    repo.orders({ from: period.from, to: period.to }),
    repo.orders({ from: period.prevFrom, to: period.prevTo }),
    repo.health(),
    repo.products(),
    repo.insights({ level: "account", from: addDays(lastFullDay, -17), to: lastFullDay }),
    repo.orders({ from: addDays(lastFullDay, -28), to: today }),
  ]);
  const costs = costSettings(ctx.workspace, products);
  const cur = kpis(ins, orders, costs);
  const prev = kpis(prevIns, prevOrders, costs);
  const attributedMain = orders.filter((o) => MAIN_PAID(o) && o.campaignId).length;
  const pendingPix = orders.filter((o) => o.status === "pending" && o.paymentMethod === "pix").length;
  const divergence = computeDivergence(cur.meta.purchases, attributedMain, pendingPix, cur.attribution.desconhecida);
  const [rows, ads] = await Promise.all([campaignRows(repo, period, health), repo.ads()]);
  const tzAcc = ctx.adAccounts[0]?.timezone ?? tz;
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
  for (const issue of fxIssues(cur.fx)) alerts.unshift({ severity: "critico", title: "Gasto sem cotação de câmbio", detail: issue, href: "/configuracoes" });
  if (divergence.ratio != null && Math.abs(divergence.ratio) > 0.3 && divergence.realPurchases + divergence.metaPurchases >= 10) {
    alerts.push({ severity: "atencao", title: "Divergência Meta × Cakto", detail: divergence.explanation, href: "/saude" });
  }

  const anomalies = detectAnomalies({
    days: anomalyDays(anomalyIns, anomalyOrders, addDays(lastFullDay, -17), lastFullDay, tz),
    health,
    orders: anomalyOrders,
    lastFullDay,
    now,
  });

  const daily = dailySeries(ins, orders, period, tz, costs);
  const recommendations: PrioritizedRecommendation[] = rows
    .filter((r) => r.campaign.effectiveStatus === "ACTIVE")
    .flatMap((r) => r.decision.recommendations.map((rec) => ({ ...rec, campaignId: r.campaign.id, campaignName: r.campaign.name })))
    .sort((a, b) => b.priority - a.priority);

  const freshness = freshnessOf(health, now);
  return {
    ctx,
    cur,
    prev,
    divergence,
    alerts,
    health,
    daily,
    anomalies,
    recommendations,
    freshness,
    top: rows.filter((r) => r.periodSpend > 0).slice(0, 6),
  };
}

/** Verificações de anomalia do workspace (usadas pelos alertas persistidos/notificados). */
export async function anomalyChecks(repo: Repository, health?: TrackingHealth) {
  const ctx = await repo.context();
  const tz = ctx.workspace.timezone;
  const today = todayIn(tz);
  const lastFullDay = addDays(today, -1);
  const [ins, orders, h] = await Promise.all([
    repo.insights({ level: "account", from: addDays(lastFullDay, -17), to: lastFullDay }),
    repo.orders({ from: addDays(lastFullDay, -28), to: today }),
    health ? Promise.resolve(health) : repo.health(),
  ]);
  return detectAnomalies({ days: anomalyDays(ins, orders, addDays(lastFullDay, -17), lastFullDay, tz), health: h, orders, lastFullDay });
}

export function freshnessOf(health: TrackingHealth, now = new Date()): Freshness[] {
  const item = (label: string, at: string | null, maxHours: number, rule: string): Freshness => {
    if (!at) return { label, at, status: "sem_dados", rule };
    const h = (now.getTime() - new Date(at).getTime()) / 3600000;
    return { label, at, status: h > maxHours ? "atrasado" : "ok", rule };
  };
  return [
    item("Sincronização do Meta", health.lastMetaSyncAt, 6, "atrasado se > 6 h (sincroniza ao abrir o painel e 1×/dia)"),
    item("Último evento da Cakto", health.lastCaktoEventAt, 48, "atrasado se > 48 h"),
    item("Último evento do script", health.lastTrackingEventAt, 24, "atrasado se > 24 h"),
  ];
}

/** Série diária para o detector de anomalias (fuso do workspace para pedidos). */
function anomalyDays(ins: InsightDaily[], orders: Order[], from: string, to: string, tz: string): AnomalyDay[] {
  const byDate = groupBy(convertible(ins), (r) => r.date);
  const paidBy = groupBy(orders.filter(PAID), (o) => paidDate(o, tz));
  return eachDay(from, to).map((date) => {
    const t = aggregateInsights(byDate.get(date) ?? []);
    const paid = paidBy.get(date) ?? [];
    return {
      date,
      spend: t.spend,
      impressions: t.impressions,
      linkClicks: t.linkClicks,
      landingPageViews: t.landingPageViews,
      initiateCheckout: t.initiateCheckout,
      metaPurchases: t.purchases,
      metaPurchaseValue: t.purchaseValue,
      purchases: paid.filter(isMain).length,
      attributedRevenue: round2(paid.filter((o) => o.campaignId).reduce((s, o) => s + o.grossAmount, 0)),
    };
  });
}

// ------------------------------- Série diária -------------------------------

export interface DailyPoint {
  date: string;
  spend: number;
  /** Faturamento bruto aprovado no dia (data de pagamento). */
  revenue: number;
  /** Lucro de contribuição estimado do dia (não é lucro líquido). */
  profit: number;
  /** Compras principais pagas (order bump/upsell não contam). */
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
export function dailySeries(ins: InsightDaily[], orders: Order[], period: Period, tz: string, costs: CostSettings): DailyPoint[] {
  const byDate = groupBy(convertible(ins), (r) => r.date);
  const approvedByDate = groupBy(
    orders.filter((o) => o.status === "paid" || o.status === "refunded" || o.status === "chargeback"),
    (o) => paidDate(o, tz),
  );
  let cumSpend = 0;
  let cumRevenue = 0;
  let cumProfit = 0;
  return eachDay(period.from, period.to).map((date) => {
    const t = aggregateInsights(byDate.get(date) ?? []);
    const d = deriveMetrics(t);
    const fin = computeFinancials(approvedByDate.get(date) ?? [], t.spend, costs);
    cumSpend += t.spend;
    cumRevenue += fin.grossApproved;
    cumProfit += fin.contribution;
    return {
      date,
      spend: t.spend,
      revenue: fin.grossApproved,
      profit: fin.contribution,
      purchases: fin.mainPurchases,
      metaPurchases: t.purchases,
      cumSpend: round2(cumSpend),
      cumRevenue: round2(cumRevenue),
      cumProfit: round2(cumProfit),
      cpa: fin.cpa,
      roas: fin.roasGross,
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
  fx: FxStatus;
}

export async function spendByDay(
  repo: Repository,
  period: Period,
  filter: { level: "campaign" | "adset" | "ad"; campaignId?: string },
): Promise<SpendMatrix> {
  const ctx = await repo.context();
  const [ins, campaigns, adsets, ads, orders, products] = await Promise.all([
    repo.insights({ level: filter.level, from: period.from, to: period.to, campaignId: filter.campaignId }),
    repo.campaigns(),
    filter.level === "adset" ? repo.adsets(filter.campaignId) : Promise.resolve([] as AdSet[]),
    filter.level === "ad" ? repo.ads(filter.campaignId) : Promise.resolve([] as Ad[]),
    repo.orders({ from: period.from, to: period.to }),
    repo.products(),
  ]);
  const names = new Map<string, string>([
    ...campaigns.map((c) => [c.id, c.name] as const),
    ...adsets.map((a) => [a.id, a.name] as const),
    ...ads.map((a) => [a.id, a.name] as const),
  ]);
  const dates = eachDay(period.from, period.to);
  const byEntity = groupBy(convertible(ins), (r) => r.entityId);
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
  const daily = dailySeries(ins, relevantOrders, period, ctx.workspace.timezone, costSettings(ctx.workspace, products));
  return { dates, entities, totals, daily, grandTotal: round2(entities.reduce((s, e) => s + e.total, 0)), fx: fxStatus(ins) };
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
  /** Fuso usado nas janelas (o da conta de anúncios). */
  timezone: string;
  /** Dias com gasto nos últimos 7. */
  daysActive: number;
}

/**
 * Janela de decisão de uma entidade. `orders` = pedidos atribuídos à entidade;
 * `pool` = vendas sem campanha identificada que podem ter vindo do Meta.
 */
function windowData(ins: InsightDaily[], orders: Order[], pool: Order[], from: string, to: string, tz: string): WindowData {
  const meta = aggregateInsights(convertible(ins).filter((r) => r.date >= from && r.date <= to));
  const inWin = (o: Order) => {
    const d = paidDate(o, tz);
    return d >= from && d <= to;
  };
  const paid = orders.filter((o) => PAID(o) && inWin(o));
  const main = paid.filter(isMain);
  return {
    meta,
    realPurchases: main.length,
    confirmedPurchases: main.filter((o) => attributionLevel(o.attributionMethod) === "confirmada").length,
    realNetRevenue: round2(paid.reduce((s, o) => s + o.netAmount, 0)),
    grossRevenue: round2(paid.reduce((s, o) => s + o.grossAmount, 0)),
    unattributedPurchases: meta.spend > 0 ? pool.filter((o) => MAIN_PAID(o) && inWin(o)).length : 0,
  };
}

function summarize(w: WindowData): WindowSummary {
  const d = deriveMetrics(w.meta);
  return {
    spend: w.meta.spend,
    purchases: w.realPurchases,
    cpa: safeDiv(w.meta.spend, w.realPurchases),
    roas: safeDiv(w.grossRevenue ?? w.realNetRevenue, w.meta.spend),
    ctr: d.ctrLink,
  };
}

export function trackingOk(health: TrackingHealth): boolean {
  const t = health.integrations.find((i) => i.provider === "tracking");
  const c = health.integrations.find((i) => i.provider === "cakto");
  return Boolean(t && c && t.status !== "error" && t.status !== "missing" && c.status !== "error" && c.status !== "missing");
}

/** Metas de decisão: do produto; sem produto, do equilíbrio MEDIDO (10+ vendas); senão padrão (sinalizado). */
export function decisionConfigFor(product: Product | null, ws: Pick<Workspace, "taxRate" | "defaultFeeRate">, measuredBreakeven: number | null): DecisionConfig {
  if (product) return configFromProduct(product, ws);
  if (measuredBreakeven != null && measuredBreakeven > 0) {
    return { ...DEFAULT_DECISION_CONFIG, maxCpa: measuredBreakeven, targetCpa: round2(measuredBreakeven * 0.7), breakevenCpa: measuredBreakeven, breakevenSource: "medido" };
  }
  return DEFAULT_DECISION_CONFIG;
}

export async function campaignRows(repo: Repository, period: Period, health?: TrackingHealth): Promise<CampaignRow[]> {
  const ctx = await repo.context();
  const wsTz = ctx.workspace.timezone;
  const accTz = new Map(ctx.adAccounts.map((a) => [a.id, a.timezone || wsTz]));
  const today = todayIn(wsTz);
  const from = period.from < addDays(today, -7) ? period.from : addDays(today, -7);
  const to = period.to > today ? period.to : today;
  const [campaigns, products, ins, orders, adsets, h, adIns, ads] = await Promise.all([
    repo.campaigns(),
    repo.products(),
    repo.insights({ level: "campaign", from, to }),
    repo.orders({ from: addDays(from, -1), to }),
    repo.adsets(),
    health ? Promise.resolve(health) : repo.health(),
    // Anúncios dos últimos 21 dias: fadiga compara início x fim da veiculação
    repo.insights({ level: "ad", from: addDays(today, -20), to: today }),
    repo.ads(),
  ]);
  const ok = trackingOk(h);
  const costs = costSettings(ctx.workspace, products);
  const insBy = groupBy(ins, (r) => r.entityId);
  const ordersBy = groupBy(orders.filter((o) => o.campaignId), (o) => o.campaignId!);
  const pool = orders.filter(couldBeMeta);
  const learning = new Set(adsets.filter((a) => a.learningStage === "LEARNING").map((a) => a.campaignId));
  const adsetsBy = groupBy(adsets, (a) => a.campaignId);
  const adInsBy = groupBy(adIns, (r) => r.entityId);
  const adName = new Map(ads.map((a) => [a.id, a.name]));
  const adsByCampaign = groupBy(ads, (a) => a.campaignId);
  const measured = computeFinancials(orders, 0, costs);
  const measuredBe = measured.mainPurchases >= 10 ? measured.breakevenCpa : null;
  // Cobertura de atribuição do workspace nos últimos 7 dias
  const cov7 = attributionSplit(orders.filter((o) => paidDate(o, wsTz) >= addDays(today, -6))).coverage;

  const fatigueFor = (campaignId: string, tz: string) => {
    const t = todayIn(tz);
    const active = (adsByCampaign.get(campaignId) ?? []).filter((a) => {
      const rows = adInsBy.get(a.id) ?? [];
      return a.effectiveStatus === "ACTIVE" && rows.some((r) => r.date >= addDays(t, -6) && r.spend > 0);
    });
    const fatigued = active.filter((a) => detectFatigue(adInsBy.get(a.id) ?? []).fatigued).map((a) => adName.get(a.id) ?? a.id);
    return { activeAds: active.length, fatiguedAds: fatigued };
  };

  return campaigns
    .map((c) => {
      // Janelas no fuso da CONTA (é nele que o Meta fecha o dia do gasto)
      const tz = accTz.get(c.adAccountId) ?? wsTz;
      const t = todayIn(tz);
      const cIns = insBy.get(c.id) ?? [];
      const cOrders = ordersBy.get(c.id) ?? [];
      const product = products.find((p) => p.id === c.productId) ?? null;
      // vendas sem origem que podem ser desta campanha: só as do produto dela (quando vinculado)
      const cPool = c.productId ? pool.filter((o) => !o.productId || o.productId === c.productId) : pool;
      const config = decisionConfigFor(product, ctx.workspace, measuredBe);
      const w1 = windowData(cIns, cOrders, cPool, t, t, tz);
      const w3 = windowData(cIns, cOrders, cPool, addDays(t, -2), t, tz);
      const w7 = windowData(cIns, cOrders, cPool, addDays(t, -6), t, tz);
      const last7 = convertible(cIns).filter((r) => r.date >= addDays(t, -6) && r.date <= t && r.spend > 0);
      const daysActive = new Set(last7.map((r) => r.date)).size;
      const dailyValues = eachDay(addDays(t, -6), t)
        .filter((d) => last7.some((r) => r.date === d))
        .map((d) => {
          const w = windowData(cIns, cOrders, [], d, d, tz);
          return safeDiv(w.grossRevenue ?? 0, w.meta.spend) ?? 0;
        });
      const periodIns = cIns.filter((r) => r.date >= period.from && r.date <= period.to);
      const periodOrders = cOrders.filter((o) => {
        const d = paidDate(o, tz);
        return d >= period.from && d <= period.to;
      });
      const pk = kpis(periodIns, periodOrders, costs);
      const dailyBudget =
        c.dailyBudget ?? ((adsetsBy.get(c.id) ?? []).filter((a) => a.effectiveStatus === "ACTIVE").reduce((s, a) => s + (a.dailyBudget ?? 0), 0) || null);
      const decision =
        c.effectiveStatus === "ACTIVE"
          ? evaluate({
              last1d: w1,
              last3d: w3,
              last7d: w7,
              prev4d: windowData(cIns, cOrders, cPool, addDays(t, -6), addDays(t, -3), tz),
              trackingOk: ok,
              learningPhase: learning.has(c.id),
              config,
              daysActive,
              dailyValues,
              attributionCoverage: cov7,
              dailyBudget,
              dataIssues: fxIssues(fxStatus(cIns.filter((r) => r.date >= addDays(t, -6)))),
              ...fatigueFor(c.id, tz),
            })
          : inactiveDecision();
      return {
        campaign: c,
        product,
        config,
        period: pk,
        periodSpend: pk.meta.spend,
        w1: summarize(w1),
        w3: summarize(w3),
        w7: summarize(w7),
        decision,
        timezone: tz,
        daysActive,
      };
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
  /** Compras principais pagas com origem nesta entidade. */
  realPurchases: number;
  confirmedPurchases: number;
  /** Faturamento bruto aprovado (inclui bump/upsell) atribuído. */
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
  const meta = aggregateInsights(convertible(ins));
  const paid = orders.filter(PAID);
  const main = paid.filter(isMain);
  const realRevenue = round2(paid.reduce((s, o) => s + o.grossAmount, 0));
  return {
    id,
    name,
    status,
    meta,
    derived: deriveMetrics(meta),
    realPurchases: main.length,
    confirmedPurchases: main.filter((o) => attributionLevel(o.attributionMethod) === "confirmada").length,
    realRevenue,
    cpaReal: safeDiv(meta.spend, main.length),
    roasReal: safeDiv(realRevenue, meta.spend),
  };
}

export async function campaignDetail(repo: Repository, campaignId: string, period: Period) {
  const ctx = await repo.context();
  const campaigns = await repo.campaigns();
  const campaign = campaigns.find((c) => c.id === campaignId);
  if (!campaign) return null;
  const tz = ctx.adAccounts.find((a) => a.id === campaign.adAccountId)?.timezone || ctx.workspace.timezone;

  const [cIns, adsetIns, adIns, adsets, ads, ordersAll, notes, rows, breakdowns, events, todayCampaign, products] = await Promise.all([
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
    repo.products(),
  ]);
  const costs = costSettings(ctx.workspace, products);
  const orders = ordersAll.filter((o) => o.campaignId === campaignId);
  const row = rows.find((r) => r.campaign.id === campaignId)!;
  const k = kpis(cIns, orders, costs);
  // Vendas do período sem campanha identificada que podem ser desta campanha (do produto dela, se vinculado)
  const poolOrders = ordersAll.filter((o) => couldBeMeta(o) && (!campaign.productId || !isMain(o) || !o.productId || o.productId === campaign.productId));
  const unattributedPool = poolOrders.filter(MAIN_PAID).length;
  const unattributedRevenue = round2(poolOrders.filter(PAID).reduce((s, o) => s + o.grossAmount, 0));
  // Cenário-limite: se TODAS essas vendas fossem desta campanha (o resultado real fica entre os dois)
  const finWithPool = unattributedPool > 0 ? computeFinancials([...orders, ...poolOrders], k.meta.spend, costs, { spendEstimated: k.fx.estimated }) : null;

  const generated = orders.filter((o) => isMain(o) && o.status !== "abandoned" && o.status !== "unknown").length;
  const funnel = [
    { key: "impressions", label: "Impressões", value: k.meta.impressions, source: "Meta" },
    { key: "linkClicks", label: "Cliques no link", value: k.meta.linkClicks, source: "Meta" },
    { key: "lpv", label: "Visualizações da página", value: k.meta.landingPageViews, source: "Meta" },
    { key: "ic", label: "Início de checkout", value: k.meta.initiateCheckout, source: "Meta" },
    { key: "generated", label: "Pedido gerado", value: generated, source: "Cakto" },
    { key: "paid", label: "Pago (compra principal)", value: k.fin.mainPurchases, source: "Cakto" },
  ].map((step, i, arr) => ({ ...step, rate: i === 0 ? null : safeDiv(step.value, arr[i - 1].value) }));

  // Etapa com a pior taxa de passagem relativa a uma referência (só com volume mínimo)
  const BENCH: Record<string, number> = { linkClicks: 0.01, lpv: 0.75, ic: 0.08, generated: 0.35, paid: 0.6 };
  let leak: { key: string; label: string; rate: number; bench: number } | null = null;
  for (let i = 1; i < funnel.length; i++) {
    const s = funnel[i];
    if (s.rate == null || !BENCH[s.key] || funnel[i - 1].value < 50) continue;
    const ratio = s.rate / BENCH[s.key];
    if (ratio < 1 && (!leak || ratio < leak.rate / leak.bench)) leak = { key: s.key, label: s.label, rate: s.rate, bench: BENCH[s.key] };
  }

  const timeline = dailySeries(cIns, orders, period, tz, costs);

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

  // Criativos: vendas da campanha sem anúncio identificado + vendas sem origem podem ser de qualquer um
  const campaignMainWithoutAd = orders.filter((o) => MAIN_PAID(o) && !o.adId).length;
  const creatives: CreativeReport = analyzeCreatives(
    adPerf.map((a) => ({
      id: a.id,
      name: a.name,
      status: a.status,
      meta: a.meta,
      purchases: a.realPurchases,
      confirmed: a.confirmedPurchases,
      revenue: a.realRevenue,
      fatigue: a.fatigue,
    })),
    { maxCpa: row.config.maxCpa, unattributed: campaignMainWithoutAd + unattributedPool },
  );

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
  const pacing = dailyBudget
    ? computePacing(convertible(todayCampaign).reduce((s, r) => s + r.spend, 0), dailyBudget, hourIn(now, tz), now.getUTCMinutes())
    : null;

  // ---- Públicos ----
  const audience = analyzeAudience(breakdowns, cIns, row.config.targetCpa);
  const highlights = audienceHighlights(audience);

  return {
    ctx,
    campaign,
    row,
    k,
    funnel,
    leak,
    timeline,
    adsetPerf,
    adsetMeta,
    adPerf,
    creatives,
    unattributedPool,
    unattributedRevenue,
    finWithPool,
    notes,
    markers,
    orders,
    pacing,
    audience,
    highlights,
    hasBreakdowns: breakdowns.length > 0,
    timezone: tz,
  };
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}

function fmtNum(v: number) {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
