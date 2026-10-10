import { describe, expect, it } from "vitest";
import type { Order } from "@/lib/data/types";
import { computeFinancials, decisionBreakeven, productBreakevenCpa } from "@/lib/metrics/finance";
import { extractItems, parseCaktoWebhook } from "@/lib/integrations/cakto/parser";

const base = {
  productId: "p1", productName: "Curso", fees: 0, currency: "BRL", coupon: null, customerEmail: null,
  createdAt: "2026-10-09T15:00:00Z", paidAt: "2026-10-09T15:00:00Z", refundedAt: null, utmSource: null, utmMedium: null,
  utmCampaign: null, utmContent: null, utmTerm: null, campaignId: null, adsetId: null, adId: null,
  attributionMethod: "unattributed" as const, attributionConfidence: 0, capiPurchaseSentAt: null,
  status: "paid" as const, paymentMethod: "pix" as const, isOrderBump: false, isUpsell: false,
};
const costs = { taxRate: 0, products: new Map() };

describe("modelo financeiro — caso real", () => {
  // 3 vendas de R$ 97 + 2 order bumps de R$ 19,90, sem taxas informadas (líquido = bruto)
  const separate: Order[] = [
    ...[1, 2, 3].map((i) => ({ ...base, id: `m${i}`, externalId: `m${i}`, grossAmount: 97, netAmount: 97 })),
    ...[1, 2].map((i) => ({ ...base, id: `b${i}`, externalId: `b${i}`, grossAmount: 19.9, netAmount: 19.9, orderKind: "bump" as const })),
  ];
  const embedded: Order[] = [
    { ...base, id: "m1", externalId: "m1", grossAmount: 116.9, netAmount: 116.9, mainAmount: 97, bumpAmount: 19.9, upsellAmount: 0 },
    { ...base, id: "m2", externalId: "m2", grossAmount: 116.9, netAmount: 116.9, mainAmount: 97, bumpAmount: 19.9, upsellAmount: 0 },
    { ...base, id: "m3", externalId: "m3", grossAmount: 97, netAmount: 97 },
  ];

  for (const [name, orders] of [["bump em pedido separado", separate], ["bump dentro do pedido", embedded]] as const) {
    it(`bate os números esperados (${name})`, () => {
      const f = computeFinancials(orders, 100, costs);
      expect(f.grossApproved).toBe(330.8);
      expect(f.mainRevenue).toBe(291);
      expect(f.bumpRevenue).toBe(39.8);
      expect(f.grossMinusAds).toBe(230.8);
      expect(f.roasGross).toBeCloseTo(3.308, 3);
      expect(f.mainPurchases).toBe(3);
      expect(f.cpa).toBeCloseTo(33.33, 2);
      expect(f.bumpOrders).toBe(2);
      expect(f.avgOrderValue).toBeCloseTo(110.27, 2);
      // sem custos configurados: contribuição = bruto − tráfego, e o sistema avisa
      expect(f.contribution).toBe(230.8);
      expect(f.costsConfigured).toBe(false);
      expect(f.notes.join(" ")).toMatch(/sem custos variáveis configurados/);
      expect(f.notes.join(" ")).toMatch(/não inclui custos fixos/);
    });
  }

  it("taxas, impostos, custos e reembolso entram no lucro de contribuição", () => {
    const orders: Order[] = [
      { ...base, id: "a", externalId: "a", grossAmount: 97, netAmount: 90.24 },
      { ...base, id: "b", externalId: "b", grossAmount: 97, netAmount: 90.24 },
      { ...base, id: "c", externalId: "c", grossAmount: 97, netAmount: 90.24, status: "refunded" },
      { ...base, id: "d", externalId: "d", grossAmount: 97, netAmount: 90.24, status: "pending" },
    ];
    const f = computeFinancials(orders, 60, { taxRate: 0.06, products: new Map([["p1", { costPerSale: 5, costPct: 0.1 }]]) });
    expect(f.grossApproved).toBe(291);
    expect(f.refunds).toBe(97);
    expect(f.revenueAfterRefunds).toBe(194);
    expect(f.fees).toBe(13.52);
    expect(f.taxes).toBe(11.64);
    expect(f.variableCosts).toBe(29.4); // 2 × 5 + 10% × 194
    expect(f.contributionBeforeAds).toBe(139.44);
    expect(f.contribution).toBe(79.44);
    expect(f.mainPurchases).toBe(3);
    expect(f.breakevenCpa).toBeCloseTo(46.48, 2);
    expect(f.costsConfigured).toBe(true);
  });

  it("CPA de equilíbrio do produto e escolha medido x produto", () => {
    const be = productBreakevenCpa({ price: 97, netPerSale: null, costPerSale: 5, costPct: 0.1, maxCpa: null }, { taxRate: 0.06, defaultFeeRate: 0.0699 });
    expect(be).toBeCloseTo(97 * (1 - 0.0699) - 97 * 0.16 - 5, 2);
    const f = computeFinancials([], 0, costs);
    expect(decisionBreakeven(f, be).source).toBe("produto");
  });
});

describe("parser Cakto — composição do pedido", () => {
  it("separa order bump listado no pedido", () => {
    const p = parseCaktoWebhook({
      secret: "x", event: "purchase_approved",
      data: { id: "A", amount: 116.9, status: "paid", offers: [{ name: "Curso", price: 97, type: "main" }, { name: "Checklist", price: 19.9, type: "orderbump" }] },
    });
    expect(p.orderKind).toBe("main");
    expect(p.mainAmount).toBe(97);
    expect(p.bumpAmount).toBe(19.9);
  });

  it("pedido que é o próprio order bump", () => {
    const p = parseCaktoWebhook({ secret: "x", event: "purchase_approved", data: { id: "B", amount: 19.9, status: "paid", type: "orderbump", parent_order: "A" } });
    expect(p.orderKind).toBe("bump");
    expect(p.bumpAmount).toBe(19.9);
    expect(p.parentOrderId).toBe("A");
  });

  it("lista de bumps dedicada e soma inconsistente", () => {
    expect(extractItems({ orderBumps: [{ price: 10 }, { price: 5, quantity: 2 }] }).map((i) => [i.kind, i.amount])).toEqual([["bump", 10], ["bump", 10]]);
    const bad = parseCaktoWebhook({ event: "purchase_approved", data: { id: "C", amount: 50, orderBumps: [{ price: 80 }] } });
    expect(bad.bumpAmount).toBe(0);
    expect(bad.warnings.join(" ")).toMatch(/composição ignorada/);
  });
});
