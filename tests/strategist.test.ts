import { describe, expect, it } from "vitest";
import type { Order, Product } from "@/lib/data/types";
import { goalPacing, offerEconomics } from "@/lib/strategist/goal";
import { PlanoSchema } from "@/lib/strategist/schema";

const order = (o: Partial<Order>): Order => ({
  id: Math.random().toString(36).slice(2),
  externalId: "x",
  productId: "p1",
  productName: "Prod",
  status: "paid",
  paymentMethod: "pix",
  grossAmount: 100,
  fees: 5,
  netAmount: 95,
  currency: "BRL",
  coupon: null,
  isOrderBump: false,
  isUpsell: false,
  customerEmail: null,
  createdAt: "2026-10-10T12:00:00Z",
  paidAt: "2026-10-10T12:00:00Z",
  refundedAt: null,
  utmSource: null,
  utmMedium: null,
  utmCampaign: null,
  utmContent: null,
  utmTerm: null,
  campaignId: "c1",
  adsetId: null,
  adId: null,
  attributionMethod: "utm_ids",
  attributionConfidence: 1,
  capiPurchaseSentAt: null,
  ...o,
});

const product = (p: Partial<Product>): Product => ({ id: "p1", name: "Escritório", price: 100, netPerSale: 95, targetCpa: null, maxCpa: null, minRoas: null, caktoProductIds: [], kind: "principal", ...p });

describe("ritmo da meta", () => {
  it("projeta o mês pelo líquido médio dos últimos 7 dias fechados", () => {
    const p = goalPacing({ goal: 10_000, today: "2026-10-14", mtd: 2_000, last7Closed: 2_100 });
    expect(p.daysInMonth).toBe(31);
    expect(p.daysClosed).toBe(13);
    expect(p.daysLeft).toBe(18);
    expect(p.runRate).toBe(300);
    expect(p.projection).toBe(2_000 + 300 * 18);
    expect(p.remaining).toBe(8_000);
    expect(p.requiredPerDay).toBeCloseTo(8_000 / 18, 2);
    expect(p.status).toBe("abaixo");
  });
  it("no ritmo, batida e sem dados", () => {
    expect(goalPacing({ goal: 10_000, today: "2026-10-14", mtd: 5_000, last7Closed: 2_800 }).status).toBe("no_ritmo");
    expect(goalPacing({ goal: 10_000, today: "2026-10-28", mtd: 10_500, last7Closed: 100 }).status).toBe("meta_batida");
    expect(goalPacing({ goal: 10_000, today: "2026-10-03", mtd: 100, last7Closed: null }).status).toBe("sem_dados");
  });
  it("prejuízo no ritmo atual é muito abaixo", () => {
    const p = goalPacing({ goal: 10_000, today: "2026-10-14", mtd: -164, last7Closed: -700 });
    expect(p.status).toBe("muito_abaixo");
    expect(p.remaining).toBe(10_164);
  });
});

describe("economia por oferta", () => {
  const costs = { taxRate: 0, products: new Map() };
  it("calcula lucro por cliente e vendas/dia para a meta só com vendas com origem", () => {
    const orders = [order({}), order({}), order({}), order({}), order({ campaignId: null })];
    const [e] = offerEconomics({
      products: [product({})],
      campaigns: [{ id: "c1", productId: "p1", active: true, spend: 160 }],
      orders,
      costs,
      requiredPerDay: 550,
    });
    expect(e.customers).toBe(4); // a venda sem origem não entra
    expect(e.netPerCustomer).toBe(95);
    expect(e.cpa).toBe(40);
    expect(e.profitPerCustomer).toBe(55);
    expect(e.salesPerDayForGoal).toBe(10);
    expect(e.role).toBe("motor");
  });
  it("oferta de ticket baixo com CPA acima do líquido é negativa e não fecha a meta", () => {
    const orders = [1, 2, 3, 4, 5].map(() => order({ productId: "p2", campaignId: "c2", grossAmount: 10, netAmount: 7.4, fees: 2.6 }));
    const [e] = offerEconomics({
      products: [product({ id: "p2", name: "Claude", price: 9.9 })],
      campaigns: [{ id: "c2", productId: "p2", active: true, spend: 80 }],
      orders,
      costs,
      requiredPerDay: 550,
    });
    expect(e.cpa).toBe(16);
    expect(e.profitPerCustomer).toBeCloseTo(-8.6, 2);
    expect(e.salesPerDayForGoal).toBeNull();
    expect(e.role).toBe("negativa");
  });
  it("ignora order bumps como oferta própria e campanhas sem produto", () => {
    const out = offerEconomics({
      products: [product({ id: "b", name: "Bump", kind: "order_bump" })],
      campaigns: [{ id: "c9", productId: null, active: true, spend: 50 }],
      orders: [],
      costs,
      requiredPerDay: 100,
    });
    expect(out).toEqual([]);
  });
});

describe("formato do plano", () => {
  it("aceita um plano mínimo válido", () => {
    const ok = PlanoSchema.safeParse({
      situacao: { resumo: "x", vai_bater_a_meta: "incerto" },
      diagnostico: [],
      ofertas: [],
      acoes_hoje: [{ prioridade: 1, campanha: null, acao: "aguardar", valor_atual: null, valor_novo: null, quando: "agora", motivo: "m", reverter_se: "r" }],
      plano_7_dias: [],
      alavancas_ticket: [],
      criativos: [],
      regras_de_escala: [],
      nao_fazer: [],
      dados_faltando: [],
    });
    expect(ok.success).toBe(true);
  });
});
