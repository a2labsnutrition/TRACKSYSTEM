import { describe, expect, it } from "vitest";
import { DEFAULT_DECISION_CONFIG, configFromProduct, evaluate, type WindowData } from "@/lib/decision/rules";
import { EMPTY_TOTALS } from "@/lib/metrics/compute";

const w = (meta: Partial<typeof EMPTY_TOTALS>, realPurchases = 0, realNetRevenue = 0): WindowData => ({
  meta: { ...EMPTY_TOTALS, ...meta }, realPurchases, realNetRevenue,
});
const cfg = { ...DEFAULT_DECISION_CONFIG, targetCpa: 50, maxCpa: 80, minRoas: 1.5 };

describe("motor de regras", () => {
  it("aguarda quando não há volume e diz quanto falta", () => {
    const r = evaluate({ last1d: w({}), last3d: w({ spend: 20, linkClicks: 20 }), last7d: w({ spend: 30, linkClicks: 40 }), trackingOk: true, config: cfg });
    expect(r.status).toBe("aguardar");
    expect(r.missingData).toMatch(/60 cliques/);
  });

  it("pausa quando gastou 2× o CPA alvo sem venda", () => {
    const r = evaluate({ last1d: w({}), last3d: w({ spend: 80 }), last7d: w({ spend: 120, linkClicks: 150, impressions: 10000, landingPageViews: 120 }), trackingOk: true, config: cfg });
    expect(r.status).toBe("pausar");
    expect(r.signals.map((s) => s.code)).toContain("gasto_sem_venda");
  });

  it("escala com CPA dentro do alvo e volume", () => {
    const r = evaluate({
      last1d: w({ spend: 60 }, 2, 180),
      last3d: w({ spend: 180, linkClicks: 300, landingPageViews: 260, impressions: 20000, reachSum: 15000 }, 5, 450),
      last7d: w({ spend: 400, linkClicks: 700, landingPageViews: 600, impressions: 50000, reachSum: 35000 }, 10, 900),
      trackingOk: true, config: cfg,
    });
    expect(r.status).toBe("escalar");
  });

  it("não escala com tracking quebrado", () => {
    const r = evaluate({
      last1d: w({}), last3d: w({ spend: 180, linkClicks: 300, landingPageViews: 260 }, 5, 450),
      last7d: w({ spend: 400, linkClicks: 700, landingPageViews: 600 }, 10, 900), trackingOk: false, config: cfg,
    });
    expect(r.status).not.toBe("escalar");
    expect(r.confidence).toBe("baixa");
  });

  it("otimiza com connect rate baixo", () => {
    const r = evaluate({
      last1d: w({}), last3d: w({ spend: 100 }, 2, 180),
      last7d: w({ spend: 200, linkClicks: 400, landingPageViews: 200, impressions: 20000, reachSum: 15000 }, 4, 360),
      trackingOk: true, config: cfg,
    });
    expect(r.status).toBe("otimizar");
    expect(r.signals.find((s) => s.code === "connect_rate_baixo")?.severity).toBe("critico");
  });

  it("deriva metas do produto", () => {
    const c = configFromProduct({ netPerSale: 100, targetCpa: null, maxCpa: null, minRoas: null });
    expect(c.targetCpa).toBe(50);
    expect(c.maxCpa).toBe(85);
  });
});

describe("motor de regras — CPA alto", () => {
  it("CPA alto só em 3 dias => otimizar; sustentado em 7 dias => pausar", () => {
    const base = { last1d: w({}), trackingOk: true, config: cfg };
    const osc = evaluate({ ...base, last3d: w({ spend: 180, linkClicks: 300, landingPageViews: 260 }, 2, 180), last7d: w({ spend: 300, linkClicks: 600, landingPageViews: 520 }, 6, 540) });
    expect(osc.status).toBe("otimizar");
    const sus = evaluate({ ...base, last3d: w({ spend: 180, linkClicks: 300, landingPageViews: 260 }, 2, 180), last7d: w({ spend: 500, linkClicks: 900, landingPageViews: 800 }, 5, 450) });
    expect(sus.status).toBe("pausar");
  });

  it("mensagens em formato brasileiro", () => {
    const r = evaluate({ last1d: w({}), last3d: w({ spend: 80 }), last7d: w({ spend: 120.5, linkClicks: 150, impressions: 10000, landingPageViews: 120 }), trackingOk: true, config: cfg });
    expect(r.headline.replace(/\s/g, " ")).toContain("R$ 120,50");
  });
});
