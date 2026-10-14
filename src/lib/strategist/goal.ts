import type { Order, Product } from "@/lib/data/types";
import { computeFinancials, type CostSettings } from "@/lib/metrics/finance";
import { safeDiv } from "@/lib/utils";

/**
 * Contas do Claudinho (determinísticas): ritmo da meta de dinheiro líquido do
 * mês e economia de cada oferta. "Líquido" = lucro de contribuição: aprovado
 * − reembolsos − taxas − impostos − custos − anúncios (sem custos fixos).
 */

export const DEFAULT_MONTHLY_GOAL = 10_000;

const r2 = (v: number) => Math.round(v * 100) / 100;

export interface GoalPacing {
  goal: number;
  month: string;
  daysInMonth: number;
  /** Dias já fechados no mês (hoje não conta). */
  daysClosed: number;
  /** Dias que faltam contando hoje. */
  daysLeft: number;
  /** Líquido do mês até agora (inclui o parcial de hoje). */
  mtd: number;
  /** Líquido médio por dia nos últimos 7 dias fechados. */
  runRate: number | null;
  /** mtd + ritmo × dias que faltam. */
  projection: number | null;
  /** Quanto falta para a meta. */
  remaining: number;
  /** Líquido por dia necessário daqui até o fim do mês. */
  requiredPerDay: number | null;
  status: "meta_batida" | "no_ritmo" | "abaixo" | "muito_abaixo" | "sem_dados";
}

export function goalPacing(o: { goal: number; today: string; mtd: number; last7Closed: number | null }): GoalPacing {
  const [y, m, d] = o.today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const daysClosed = d - 1;
  const daysLeft = daysInMonth - d + 1;
  const runRate = o.last7Closed == null ? null : r2(o.last7Closed / 7);
  const projection = runRate == null ? null : r2(o.mtd + runRate * daysLeft);
  const remaining = r2(Math.max(0, o.goal - o.mtd));
  const requiredPerDay = daysLeft > 0 ? r2(remaining / daysLeft) : null;
  let status: GoalPacing["status"];
  if (o.mtd >= o.goal) status = "meta_batida";
  else if (projection == null) status = "sem_dados";
  else if (projection >= o.goal) status = "no_ritmo";
  else if (projection >= o.goal * 0.6) status = "abaixo";
  else status = "muito_abaixo";
  return { goal: o.goal, month: `${y}-${String(m).padStart(2, "0")}`, daysInMonth, daysClosed, daysLeft, mtd: r2(o.mtd), runRate, projection, remaining, requiredPerDay, status };
}

export const PACING_LABEL: Record<GoalPacing["status"], string> = {
  meta_batida: "Meta batida",
  no_ritmo: "No ritmo da meta",
  abaixo: "Abaixo do ritmo",
  muito_abaixo: "Muito abaixo do ritmo",
  sem_dados: "Sem dados suficientes",
};

export interface OfferEconomics {
  productId: string;
  productName: string;
  price: number;
  campaigns: number;
  activeCampaigns: number;
  /** Gasto com anúncios das campanhas da oferta (R$, convertido). */
  spend: number;
  /** Clientes = compras principais pagas com origem nas campanhas da oferta. */
  customers: number;
  /** Líquido por cliente antes do tráfego (principal + bump + upsell − taxas − impostos − custos). */
  netPerCustomer: number | null;
  /** Ticket bruto médio por cliente (com bump/upsell). */
  avgOrderValue: number | null;
  cpa: number | null;
  /** Lucro por cliente depois do anúncio. */
  profitPerCustomer: number | null;
  /** Lucro de contribuição da oferta no período. */
  contribution: number;
  /** Vendas por dia que esta oferta precisaria, sozinha, para cobrir o líquido diário que falta. */
  salesPerDayForGoal: number | null;
  role: "motor" | "positiva" | "negativa" | "sem_dados";
}

/**
 * Economia das ofertas no período: só pedidos COM origem nas campanhas
 * vinculadas ao produto (vendas sem origem ficam de fora).
 */
export function offerEconomics(o: {
  products: Product[];
  campaigns: Array<{ id: string; productId: string | null; active: boolean; spend: number }>;
  orders: Order[];
  costs: CostSettings;
  requiredPerDay: number | null;
}): OfferEconomics[] {
  const out: OfferEconomics[] = [];
  for (const p of o.products.filter((x) => (x.kind ?? "principal") === "principal")) {
    const camps = o.campaigns.filter((c) => c.productId === p.id);
    if (!camps.length) continue;
    const ids = new Set(camps.map((c) => c.id));
    const spend = r2(camps.reduce((s, c) => s + c.spend, 0));
    const fin = computeFinancials(
      o.orders.filter((x) => x.campaignId && ids.has(x.campaignId)),
      spend,
      o.costs,
    );
    const customers = fin.mainPurchases;
    const netPerCustomer = customers ? r2(fin.contributionBeforeAds / customers) : null;
    const cpa = safeDiv(spend, customers);
    const profitPerCustomer = netPerCustomer != null && cpa != null ? r2(netPerCustomer - cpa) : null;
    const salesPerDayForGoal =
      profitPerCustomer != null && profitPerCustomer > 0 && o.requiredPerDay != null ? Math.ceil(o.requiredPerDay / profitPerCustomer) : null;
    out.push({
      productId: p.id,
      productName: p.name,
      price: p.price,
      campaigns: camps.length,
      activeCampaigns: camps.filter((c) => c.active).length,
      spend,
      customers,
      netPerCustomer,
      avgOrderValue: fin.avgOrderValue,
      cpa: cpa == null ? null : r2(cpa),
      profitPerCustomer,
      contribution: fin.contribution,
      salesPerDayForGoal,
      role: customers < 3 ? "sem_dados" : fin.contribution > 0 ? "positiva" : "negativa",
    });
  }
  // Motor de lucro: a oferta positiva com maior lucro no período
  const best = out.filter((x) => x.role === "positiva").sort((a, b) => b.contribution - a.contribution)[0];
  if (best) best.role = "motor";
  return out.sort((a, b) => b.contribution - a.contribution);
}
