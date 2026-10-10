import { orderParts, type Order, type Product } from "@/lib/data/types";
import { safeDiv } from "@/lib/utils";

/**
 * Resultado financeiro real de um conjunto de pedidos x gasto.
 *
 * Definições (mostradas na interface em "Como calculamos"):
 *  - Faturamento bruto aprovado = pedidos que foram pagos no período (inclui os
 *    que depois foram reembolsados), dividido em produto principal / order bump / upsell.
 *  - Faturamento após reembolsos = bruto − reembolsos − chargebacks.
 *  - Taxas = taxas da Cakto dos pedidos mantidos (estimadas quando a Cakto não informa).
 *  - Impostos = alíquota do workspace × faturamento após reembolsos.
 *  - Custos variáveis = custo por venda × compras principais mantidas + % do faturamento (por produto).
 *  - Contribuição antes de anúncios = faturamento após reembolsos − taxas − impostos − custos variáveis.
 *  - Lucro de contribuição = contribuição antes de anúncios − gasto com anúncios.
 *    NÃO é lucro líquido: não inclui custos fixos (equipe, ferramentas, pró-labore).
 *  - CPA de equilíbrio = contribuição antes de anúncios ÷ compras principais aprovadas.
 *  - ROAS de equilíbrio = faturamento bruto ÷ contribuição antes de anúncios.
 */

export interface CostSettings {
  taxRate: number;
  /** Custos por produto (id interno) — produto sem custo configurado entra como 0 e é sinalizado. */
  products: Map<string, Pick<Product, "costPerSale" | "costPct">>;
}

export interface Financials {
  grossApproved: number;
  mainRevenue: number;
  bumpRevenue: number;
  upsellRevenue: number;
  refunds: number;
  refundCount: number;
  revenueAfterRefunds: number;
  fees: number;
  /** Fração do faturamento cujas taxas foram ESTIMADAS (a Cakto não informou o líquido). */
  feesEstimatedShare: number;
  taxes: number;
  variableCosts: number;
  /** false se há vendas de produtos sem custo configurado. */
  costsConfigured: boolean;
  adSpend: number;
  /** Faturamento bruto − tráfego (antes de taxas, impostos e outros custos). */
  grossMinusAds: number;
  contributionBeforeAds: number;
  contribution: number;
  contributionMargin: number | null;
  /** Compras do produto principal aprovadas (pedidos de bump/upsell não contam). */
  mainPurchases: number;
  mainPurchasesKept: number;
  bumpOrders: number;
  upsellOrders: number;
  /** Ticket médio por compra principal (inclui bump/upsell da mesma compra). */
  avgOrderValue: number | null;
  cpa: number | null;
  roasGross: number | null;
  roasAfterRefunds: number | null;
  breakevenCpa: number | null;
  breakevenRoas: number | null;
  /** O que é estimado ou está faltando — vai para a interface e para a IA. */
  notes: string[];
}

const APPROVED = new Set(["paid", "refunded", "chargeback"]);
const r2 = (v: number) => Math.round(v * 100) / 100;

export function computeFinancials(orders: Order[], adSpend: number, costs: CostSettings, opts: { spendEstimated?: boolean } = {}): Financials {
  let gross = 0;
  let main = 0;
  let bump = 0;
  let upsell = 0;
  let refunds = 0;
  let refundCount = 0;
  let fees = 0;
  let estimatedRevenue = 0;
  let keptRevenue = 0;
  let mainPurchases = 0;
  let mainKept = 0;
  let bumpOrders = 0;
  let upsellOrders = 0;
  let perSaleCosts = 0;
  let pctCosts = 0;
  let missingCosts = false;

  for (const o of orders) {
    if (!APPROVED.has(o.status)) continue;
    const p = orderParts(o);
    gross += o.grossAmount;
    main += p.main;
    bump += p.bump;
    upsell += p.upsell;
    if (p.kind === "main") mainPurchases++;
    else if (p.kind === "bump") bumpOrders++;
    else upsellOrders++;
    // bump dentro do pedido principal também conta como bump vendido
    if (p.kind === "main" && p.bump > 0) bumpOrders++;
    if (p.kind === "main" && p.upsell > 0) upsellOrders++;

    if (o.status !== "paid") {
      refunds += o.grossAmount;
      refundCount++;
      continue;
    }
    keptRevenue += o.grossAmount;
    fees += Math.max(0, o.grossAmount - o.netAmount);
    if (o.netEstimated) estimatedRevenue += o.grossAmount;
    if (p.kind === "main") mainKept++;

    const c = o.productId ? costs.products.get(o.productId) : undefined;
    if (!c || ((c.costPerSale ?? 0) === 0 && (c.costPct ?? 0) === 0)) missingCosts = true;
    if (p.kind === "main") perSaleCosts += c?.costPerSale ?? 0;
    pctCosts += o.grossAmount * (c?.costPct ?? 0);
  }

  const revenueAfterRefunds = r2(gross - refunds);
  const taxes = r2(revenueAfterRefunds * costs.taxRate);
  const variableCosts = r2(perSaleCosts + pctCosts);
  const contributionBeforeAds = r2(revenueAfterRefunds - fees - taxes - variableCosts);
  const contribution = r2(contributionBeforeAds - adSpend);

  const notes: string[] = [];
  if (opts.spendEstimated) notes.push("Gasto convertido de outra moeda com câmbio estimado (cotação + IOF/spread).");
  const feesEstimatedShare = keptRevenue > 0 ? estimatedRevenue / keptRevenue : 0;
  if (feesEstimatedShare > 0) notes.push(`Taxas da Cakto estimadas com a taxa padrão em pedidos que somam ${Math.round(feesEstimatedShare * 100)}% do faturamento (o webhook não informou o líquido).`);
  if (missingCosts && keptRevenue > 0) notes.push("Há vendas de produtos sem custos variáveis configurados: o lucro de contribuição pode estar superestimado.");
  if (costs.taxRate === 0 && keptRevenue > 0) notes.push("Alíquota de impostos = 0%: configure em Configurações se houver imposto sobre a venda.");
  notes.push("Lucro de contribuição não inclui custos fixos (equipe, ferramentas, pró-labore).");

  return {
    grossApproved: r2(gross),
    mainRevenue: r2(main),
    bumpRevenue: r2(bump),
    upsellRevenue: r2(upsell),
    refunds: r2(refunds),
    refundCount,
    revenueAfterRefunds,
    fees: r2(fees),
    feesEstimatedShare,
    taxes,
    variableCosts,
    costsConfigured: !missingCosts,
    adSpend: r2(adSpend),
    grossMinusAds: r2(gross - adSpend),
    contributionBeforeAds,
    contribution,
    contributionMargin: safeDiv(contribution, revenueAfterRefunds),
    mainPurchases,
    mainPurchasesKept: mainKept,
    bumpOrders,
    upsellOrders,
    avgOrderValue: safeDiv(r2(gross), mainPurchases),
    cpa: safeDiv(adSpend, mainPurchases),
    roasGross: safeDiv(gross, adSpend),
    roasAfterRefunds: safeDiv(revenueAfterRefunds, adSpend),
    breakevenCpa: mainPurchases > 0 ? r2(contributionBeforeAds / mainPurchases) : null,
    breakevenRoas: contributionBeforeAds > 0 ? safeDiv(gross, contributionBeforeAds) : null,
    notes,
  };
}

/**
 * CPA de equilíbrio a partir da configuração do produto (quando ainda não há
 * vendas suficientes para medir o ticket médio real).
 */
export function productBreakevenCpa(
  product: Pick<Product, "price" | "netPerSale" | "costPerSale" | "costPct" | "maxCpa"> | null,
  ws: { taxRate: number; defaultFeeRate: number },
): number | null {
  if (!product || !(product.price > 0)) return null;
  const net = product.netPerSale ?? product.price * (1 - ws.defaultFeeRate);
  const be = net - product.price * (ws.taxRate + (product.costPct ?? 0)) - (product.costPerSale ?? 0);
  return be > 0 ? r2(be) : 0;
}

/**
 * CPA de equilíbrio a usar nas decisões: o medido (se houver vendas suficientes
 * para o ticket médio ser estável) ou o do produto. Retorna também a origem.
 */
export function decisionBreakeven(fin: Financials, productBe: number | null, minSalesForObserved = 10): { value: number | null; source: "medido" | "produto" | "nenhum" } {
  if (fin.breakevenCpa != null && fin.mainPurchases >= minSalesForObserved) return { value: fin.breakevenCpa, source: "medido" };
  if (productBe != null) return { value: productBe, source: "produto" };
  if (fin.breakevenCpa != null) return { value: fin.breakevenCpa, source: "medido" };
  return { value: null, source: "nenhum" };
}
