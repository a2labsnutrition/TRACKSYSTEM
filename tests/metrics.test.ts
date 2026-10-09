import { describe, expect, it } from "vitest";
import {
  aggregateInsights, aggregateOrders, computeDivergence, computePacing, computeProfit, deriveMetrics, detectFatigue,
} from "@/lib/metrics/compute";
import type { InsightDaily, Order } from "@/lib/data/types";

function row(p: Partial<InsightDaily>): InsightDaily {
  return {
    level: "campaign", entityId: "c1", campaignId: "c1", adsetId: null, date: "2026-10-01",
    spend: 0, impressions: 0, reach: 0, clicks: 0, linkClicks: 0, landingPageViews: 0, initiateCheckout: 0,
    addPaymentInfo: 0, purchases: 0, purchaseValue: 0, video3s: 0, thruplay: 0, videoP25: 0, videoP50: 0,
    videoP75: 0, videoP95: 0, videoP100: 0, videoAvgTimeSec: null, qualityRanking: null, engagementRanking: null,
    conversionRanking: null, ...p,
  };
}

describe("métricas calculadas", () => {
  it("agrega e deriva taxas do funil", () => {
    const t = aggregateInsights([
      row({ date: "2026-10-01", spend: 100, impressions: 10000, reach: 5000, clicks: 300, linkClicks: 200, landingPageViews: 150, initiateCheckout: 15, purchases: 3, purchaseValue: 291, video3s: 3000, thruplay: 900 }),
      row({ date: "2026-10-02", spend: 50.5, impressions: 5000, reach: 3000, clicks: 100, linkClicks: 100, landingPageViews: 60, initiateCheckout: 6, purchases: 1, purchaseValue: 97 }),
    ]);
    expect(t.spend).toBe(150.5);
    expect(t.days).toBe(2);
    const d = deriveMetrics(t);
    expect(d.cpm).toBeCloseTo(10.0333, 3);
    expect(d.ctrLink).toBeCloseTo(0.02);
    expect(d.connectRate).toBeCloseTo(0.7);
    expect(d.checkoutRate).toBeCloseTo(0.1);
    expect(d.purchaseRate).toBeCloseTo(4 / 21);
    expect(d.hookRate).toBeCloseTo(0.2);
    expect(d.holdRate).toBeCloseTo(0.3);
    expect(d.cpaMeta).toBeCloseTo(37.625);
    expect(d.frequency).toBeCloseTo(15000 / 8000);
  });

  it("não divide por zero", () => {
    const d = deriveMetrics(aggregateInsights([]));
    expect(d.cpm).toBeNull();
    expect(d.connectRate).toBeNull();
    expect(d.roasMeta).toBeNull();
  });

  it("receita real, aprovação por método e lucro", () => {
    const base = { productId: null, productName: null, fees: 0, currency: "BRL", coupon: null, isOrderBump: false, isUpsell: false,
      customerEmail: null, createdAt: "2026-10-01T10:00:00Z", paidAt: null, refundedAt: null, utmSource: null, utmMedium: null,
      utmCampaign: null, utmContent: null, utmTerm: null, campaignId: null, adsetId: null, adId: null,
      attributionMethod: "unattributed" as const, attributionConfidence: 0, capiPurchaseSentAt: null };
    const orders: Order[] = [
      { ...base, id: "1", externalId: "1", status: "paid", paymentMethod: "pix", grossAmount: 97, netAmount: 90 },
      { ...base, id: "2", externalId: "2", status: "pending", paymentMethod: "pix", grossAmount: 97, netAmount: 90 },
      { ...base, id: "3", externalId: "3", status: "paid", paymentMethod: "credit_card", grossAmount: 97, netAmount: 88 },
      { ...base, id: "4", externalId: "4", status: "abandoned", paymentMethod: "other", grossAmount: 97, netAmount: 90 },
    ];
    const r = aggregateOrders(orders);
    expect(r.paidOrders).toBe(2);
    expect(r.netRevenue).toBe(178);
    expect(r.byMethod.pix.approvalRate).toBe(0.5);
    expect(r.byMethod.credit_card.approvalRate).toBe(1);
    expect(r.byMethod.other).toBeUndefined();
    const p = computeProfit(100, r, 0.1);
    expect(p.taxes).toBe(17.8);
    expect(p.profit).toBe(60.2);
    expect(p.roasReal).toBeCloseTo(1.78);
    expect(p.cpaReal).toBe(50);
  });

  it("divergência Meta × real", () => {
    expect(computeDivergence(10, 10, 0).explanation).toMatch(/alinhados/);
    expect(computeDivergence(15, 10, 4).explanation).toMatch(/Pix/);
    expect(computeDivergence(5, 10, 0).explanation).toMatch(/cookies/);
  });

  it("pacing projeta o fim do dia", () => {
    const p = computePacing(50, 100, 12);
    expect(p.pctOfBudget).toBe(0.5);
    expect(p.projectedEndOfDay).toBe(100);
  });

  it("detecta fadiga de criativo", () => {
    const days = Array.from({ length: 8 }, (_, i) => {
      const early = i < 3;
      return row({
        date: `2026-10-0${i + 1}`, impressions: 10000, reach: early ? 8000 : 3500,
        linkClicks: early ? 200 : 100, video3s: early ? 3000 : 1800,
      });
    });
    const f = detectFatigue(days);
    expect(f.fatigued).toBe(true);
    expect(f.reason).toMatch(/CTR caiu 50%/);
  });
});
