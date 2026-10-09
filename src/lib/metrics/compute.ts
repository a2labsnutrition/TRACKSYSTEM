import type { InsightDaily, Order } from "@/lib/data/types";
import { safeDiv } from "@/lib/utils";

/**
 * Cálculo determinístico de métricas. A IA nunca calcula números: ela recebe
 * o resultado destas funções.
 */

export interface MetaTotals {
  spend: number;
  impressions: number;
  /** Soma dos alcances diários — NÃO é o alcance único do período (aproximação). */
  reachSum: number;
  clicks: number;
  linkClicks: number;
  landingPageViews: number;
  initiateCheckout: number;
  addPaymentInfo: number;
  purchases: number;
  purchaseValue: number;
  video3s: number;
  thruplay: number;
  videoP25: number;
  videoP50: number;
  videoP75: number;
  videoP95: number;
  videoP100: number;
  days: number;
}

export const EMPTY_TOTALS: MetaTotals = {
  spend: 0,
  impressions: 0,
  reachSum: 0,
  clicks: 0,
  linkClicks: 0,
  landingPageViews: 0,
  initiateCheckout: 0,
  addPaymentInfo: 0,
  purchases: 0,
  purchaseValue: 0,
  video3s: 0,
  thruplay: 0,
  videoP25: 0,
  videoP50: 0,
  videoP75: 0,
  videoP95: 0,
  videoP100: 0,
  days: 0,
};

export function aggregateInsights(rows: InsightDaily[]): MetaTotals {
  const t: MetaTotals = { ...EMPTY_TOTALS };
  const days = new Set<string>();
  for (const r of rows) {
    t.spend += r.spend;
    t.impressions += r.impressions;
    t.reachSum += r.reach;
    t.clicks += r.clicks;
    t.linkClicks += r.linkClicks;
    t.landingPageViews += r.landingPageViews;
    t.initiateCheckout += r.initiateCheckout;
    t.addPaymentInfo += r.addPaymentInfo;
    t.purchases += r.purchases;
    t.purchaseValue += r.purchaseValue;
    t.video3s += r.video3s;
    t.thruplay += r.thruplay;
    t.videoP25 += r.videoP25;
    t.videoP50 += r.videoP50;
    t.videoP75 += r.videoP75;
    t.videoP95 += r.videoP95;
    t.videoP100 += r.videoP100;
    days.add(r.date);
  }
  t.days = days.size;
  t.spend = round2(t.spend);
  t.purchaseValue = round2(t.purchaseValue);
  return t;
}

export interface DerivedMetrics {
  cpm: number | null;
  ctrAll: number | null;
  ctrLink: number | null;
  cpcAll: number | null;
  cpcLink: number | null;
  /** Frequência aproximada (impressões ÷ soma do alcance diário). */
  frequency: number | null;
  connectRate: number | null;
  checkoutRate: number | null;
  purchaseRate: number | null;
  lpToPurchase: number | null;
  hookRate: number | null;
  holdRate: number | null;
  costPerLpv: number | null;
  costPerCheckout: number | null;
  costPerPaymentInfo: number | null;
  cpaMeta: number | null;
  roasMeta: number | null;
}

export function deriveMetrics(t: MetaTotals): DerivedMetrics {
  return {
    cpm: mul(safeDiv(t.spend, t.impressions), 1000),
    ctrAll: safeDiv(t.clicks, t.impressions),
    ctrLink: safeDiv(t.linkClicks, t.impressions),
    cpcAll: safeDiv(t.spend, t.clicks),
    cpcLink: safeDiv(t.spend, t.linkClicks),
    frequency: safeDiv(t.impressions, t.reachSum),
    connectRate: safeDiv(t.landingPageViews, t.linkClicks),
    checkoutRate: safeDiv(t.initiateCheckout, t.landingPageViews),
    purchaseRate: safeDiv(t.purchases, t.initiateCheckout),
    lpToPurchase: safeDiv(t.purchases, t.landingPageViews),
    // Sem reproduções de vídeo (anúncio de imagem) => não se aplica
    hookRate: t.video3s > 0 ? safeDiv(t.video3s, t.impressions) : null,
    holdRate: safeDiv(t.thruplay, t.video3s),
    costPerLpv: safeDiv(t.spend, t.landingPageViews),
    costPerCheckout: safeDiv(t.spend, t.initiateCheckout),
    costPerPaymentInfo: safeDiv(t.spend, t.addPaymentInfo),
    cpaMeta: safeDiv(t.spend, t.purchases),
    roasMeta: safeDiv(t.purchaseValue, t.spend),
  };
}

// ----------------------------- Receita real (Cakto) -----------------------------

export interface RealTotals {
  paidOrders: number;
  grossRevenue: number;
  netRevenue: number;
  refunds: number;
  refundedAmount: number;
  generatedOrders: number;
  byMethod: Record<string, { generated: number; paid: number; approvalRate: number | null }>;
}

const PAID_LIKE = new Set(["paid"]);
const GENERATED_LIKE = new Set(["paid", "pending", "refused", "refunded", "chargeback", "canceled"]);

export function aggregateOrders(orders: Order[]): RealTotals {
  const byMethod: RealTotals["byMethod"] = {};
  let paidOrders = 0;
  let grossRevenue = 0;
  let netRevenue = 0;
  let refunds = 0;
  let refundedAmount = 0;
  let generatedOrders = 0;
  for (const o of orders) {
    if (o.status === "abandoned" || o.status === "unknown") continue;
    const m = (byMethod[o.paymentMethod] ??= { generated: 0, paid: 0, approvalRate: null });
    if (GENERATED_LIKE.has(o.status)) {
      generatedOrders++;
      m.generated++;
    }
    if (PAID_LIKE.has(o.status)) {
      paidOrders++;
      m.paid++;
      grossRevenue += o.grossAmount;
      netRevenue += o.netAmount;
    }
    if (o.status === "refunded" || o.status === "chargeback") {
      refunds++;
      refundedAmount += o.netAmount;
      // venda que foi paga e depois estornada também conta como "paga" na taxa de aprovação
      m.paid++;
    }
  }
  for (const m of Object.values(byMethod)) m.approvalRate = safeDiv(m.paid, m.generated);
  return {
    paidOrders,
    grossRevenue: round2(grossRevenue),
    netRevenue: round2(netRevenue),
    refunds,
    refundedAmount: round2(refundedAmount),
    generatedOrders,
    byMethod,
  };
}

export interface ProfitMetrics {
  netRevenue: number;
  taxes: number;
  profit: number;
  roasReal: number | null;
  cpaReal: number | null;
  roi: number | null;
  margin: number | null;
}

export function computeProfit(spend: number, real: RealTotals, taxRate: number): ProfitMetrics {
  const taxes = round2(real.netRevenue * taxRate);
  const profit = round2(real.netRevenue - taxes - spend);
  return {
    netRevenue: real.netRevenue,
    taxes,
    profit,
    roasReal: safeDiv(real.netRevenue, spend),
    cpaReal: safeDiv(spend, real.paidOrders),
    roi: safeDiv(profit, spend),
    margin: safeDiv(profit, real.netRevenue),
  };
}

export interface Divergence {
  metaPurchases: number;
  realPurchases: number;
  diff: number;
  /** (meta - real) / real */
  ratio: number | null;
  explanation: string;
}

export function computeDivergence(metaPurchases: number, realAttributedPurchases: number, pendingPix: number): Divergence {
  const diff = metaPurchases - realAttributedPurchases;
  const ratio = safeDiv(diff, realAttributedPurchases);
  let explanation = "Números alinhados.";
  if (realAttributedPurchases === 0 && metaPurchases === 0) explanation = "Sem compras no período.";
  else if (ratio != null && Math.abs(ratio) <= 0.15) explanation = "Números alinhados (diferença até 15% é normal).";
  else if (diff > 0)
    explanation =
      pendingPix > 0
        ? `Meta conta mais compras que a Cakto confirmou. Provável: ${pendingPix} Pix gerados e não pagos contados como compra pelo Pixel, ou janela de atribuição do Meta (7 dias clique/1 dia visualização) pegando vendas de outras origens.`
        : "Meta conta mais compras que a Cakto confirmou. Provável: janela de atribuição do Meta (inclui visualização), evento Purchase disparado em duplicidade ou vendas atribuídas a outra origem.";
  else
    explanation =
      "A Cakto confirmou mais vendas atribuídas a anúncios do que o Meta registrou. Provável: bloqueio de cookies/navegador, Pixel não disparando na confirmação ou CAPI ainda não ativa.";
  return { metaPurchases, realPurchases: realAttributedPurchases, diff, ratio, explanation };
}

// ----------------------------- Pacing -----------------------------

export interface Pacing {
  spentToday: number;
  dailyBudget: number;
  pctOfBudget: number | null;
  projectedEndOfDay: number | null;
  /** fração do dia já transcorrida no fuso da conta */
  dayElapsed: number;
}

export function computePacing(spentToday: number, dailyBudget: number, hourOfDay: number, minuteOfHour = 0): Pacing {
  const dayElapsed = Math.min(1, Math.max(0, (hourOfDay * 60 + minuteOfHour) / 1440));
  return {
    spentToday,
    dailyBudget,
    pctOfBudget: safeDiv(spentToday, dailyBudget),
    projectedEndOfDay: dayElapsed > 0.05 ? round2(spentToday / dayElapsed) : null,
    dayElapsed,
  };
}

// ----------------------------- Fadiga -----------------------------

export interface FatigueSignal {
  fatigued: boolean;
  ctrDrop: number | null;
  hookDrop: number | null;
  frequency: number | null;
  reason: string | null;
}

/**
 * Compara os primeiros dias de veiculação do anúncio com os últimos dias.
 * Fadiga = CTR (ou hook rate) caiu >= 25% e frequência recente >= 2.
 */
export function detectFatigue(daily: InsightDaily[], windowDays = 3): FatigueSignal {
  const sorted = [...daily].filter((d) => d.impressions > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.length < windowDays * 2) {
    return { fatigued: false, ctrDrop: null, hookDrop: null, frequency: null, reason: null };
  }
  const first = aggregateInsights(sorted.slice(0, windowDays));
  const last = aggregateInsights(sorted.slice(-windowDays));
  const ctrFirst = safeDiv(first.linkClicks, first.impressions);
  const ctrLast = safeDiv(last.linkClicks, last.impressions);
  const hookFirst = safeDiv(first.video3s, first.impressions);
  const hookLast = safeDiv(last.video3s, last.impressions);
  const ctrDrop = ctrFirst && ctrLast != null ? (ctrFirst - ctrLast) / ctrFirst : null;
  const hookDrop = hookFirst && hookLast != null ? (hookFirst - hookLast) / hookFirst : null;
  const frequency = safeDiv(last.impressions, last.reachSum);
  const dropped = (ctrDrop ?? 0) >= 0.25 || (hookDrop ?? 0) >= 0.25;
  const fatigued = dropped && (frequency ?? 0) >= 2;
  let reason: string | null = null;
  if (fatigued) {
    const parts: string[] = [];
    if (ctrDrop != null && ctrDrop >= 0.25) parts.push(`CTR caiu ${(ctrDrop * 100).toFixed(0)}%`);
    if (hookDrop != null && hookDrop >= 0.25) parts.push(`hook rate caiu ${(hookDrop * 100).toFixed(0)}%`);
    parts.push(`frequência ${frequency?.toFixed(1)}`);
    reason = parts.join(", ");
  }
  return { fatigued, ctrDrop, hookDrop, frequency, reason };
}

function mul(v: number | null, k: number): number | null {
  return v == null ? null : v * k;
}

export function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
