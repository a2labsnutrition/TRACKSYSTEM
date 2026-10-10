import { describe, expect, it } from "vitest";
import { DEFAULT_DECISION_CONFIG, INSUFFICIENT_SCALE, configFromProduct, evaluate, type DecisionInput, type WindowData } from "@/lib/decision/rules";
import { EMPTY_TOTALS } from "@/lib/metrics/compute";

const w = (meta: Partial<typeof EMPTY_TOTALS>, realPurchases = 0, realNetRevenue = 0, unattributedPurchases = 0): WindowData => ({
  meta: { ...EMPTY_TOTALS, ...meta },
  realPurchases,
  realNetRevenue,
  grossRevenue: realNetRevenue,
  unattributedPurchases,
});
// CPA máximo (equilíbrio) R$ 80, vindo do produto
const cfg = { ...DEFAULT_DECISION_CONFIG, targetCpa: 56, maxCpa: 80, minRoas: 1.5, breakevenCpa: 80, breakevenSource: "produto" as const };
const funnel = { impressions: 60000, reachSum: 50000, linkClicks: 1200, landingPageViews: 1000 };
const input = (last7d: WindowData, extra: Partial<DecisionInput> = {}): DecisionInput => ({
  last1d: w({}),
  last3d: w({ spend: last7d.meta.spend * 0.4, ...funnel }, Math.round(last7d.realPurchases * 0.4), last7d.realNetRevenue * 0.4),
  last7d,
  trackingOk: true,
  config: cfg,
  attributionCoverage: 0.9,
  ...extra,
});

describe("motor de decisão — sem vendas", () => {
  it("pouco gasto sem venda → aguardar e diz quanto falta (sem regra fixa)", () => {
    const r = evaluate(input(w({ spend: 30, linkClicks: 40 })));
    expect(r.status).toBe("aguardar");
    expect(r.evidence).toBe("sem_vendas");
    // e^-3 ≈ 5%: 3 × CPA máximo
    expect(r.missingData?.replace(/\s/g, " ")).toContain("R$ 240,00");
    expect(r.headline).toContain(INSUFFICIENT_SCALE);
  });

  it("gasto sem venda improvável por acaso (P < 5% no CPA máximo) → pausar", () => {
    const r = evaluate(input(w({ spend: 300, ...funnel })));
    expect(r.evidence).toBe("deficitario_sem_vendas");
    expect(r.status).toBe("pausar");
    expect(r.signals.map((s) => s.code)).toContain("gasto_sem_venda");
    expect(r.headline.replace(/\s/g, " ")).toContain("R$ 300,00");
    expect(r.recommendations[0].action).toBe("pausar");
  });

  it("sinal intermediário (P entre 5% e 20%) → otimizar o funil, não pausar", () => {
    const r = evaluate(input(w({ spend: 160, ...funnel })));
    expect(r.evidence).toBe("alerta_sem_vendas");
    expect(r.status).toBe("otimizar");
  });

  it("com 1 dia de veiculação prefere reduzir a pausar", () => {
    const r = evaluate(input(w({ spend: 300, ...funnel }), { daysActive: 1 }));
    expect(r.status).not.toBe("pausar");
  });

  it("vendas sem origem impedem concluir prejuízo e pedem correção do tracking", () => {
    const r = evaluate(input(w({ spend: 300, ...funnel }, 0, 0, 3)));
    expect(r.evidence).toBe("vendas_sem_origem");
    expect(r.status).toBe("aguardar");
    expect(r.recommendations[0].action).toBe("corrigir_tracking");
  });

  it("respeita o orçamento mínimo de teste definido no produto", () => {
    const c = configFromProduct({ netPerSale: 100, targetCpa: null, maxCpa: null, minRoas: null, rules: { minTestBudget: 300 } });
    const r = evaluate({ ...input(w({ spend: 200, linkClicks: 300 })), config: c });
    expect(r.status).toBe("aguardar");
    expect(r.missingData?.replace(/\s/g, " ")).toContain("R$ 100,00");
  });
});

describe("motor de decisão — com vendas", () => {
  it("escala só com lucro comprovado, 3+ dias e confiança ≥ moderada; passo proporcional à folga", () => {
    const r = evaluate(input(w({ spend: 750, ...funnel }, 25, 2425), { daysActive: 7, dailyBudget: 100 }));
    expect(r.evidence).toBe("lucrativo");
    expect(r.confidence).not.toBe("baixa");
    expect(r.status).toBe("escalar");
    const up = r.recommendations.find((x) => x.action === "aumentar_gradual")!;
    expect(up).toBeDefined();
    expect(up.title).toMatch(/~15%/); // folga 42% × 0,35 → 15% (não um "20% fixo")
    expect(up.impact?.lowPerDay).toBeGreaterThan(0);
    expect(up.invalidation.length).toBeGreaterThan(0);
    expect(up.reassess).toBeTruthy();
    expect(up.calc.length).toBeGreaterThan(0);
  });

  it("mesmo resultado com 1 dia de veiculação → manter + dados insuficientes", () => {
    const r = evaluate(input(w({ spend: 750, ...funnel }, 25, 2425), { daysActive: 1 }));
    expect(r.status).toBe("manter");
    expect(r.recommendations.some((x) => x.justification.includes(INSUFFICIENT_SCALE))).toBe(true);
  });

  it("3 vendas com CPA bom não bastam: intervalo de 95% ainda inclui o CPA máximo", () => {
    const r = evaluate(input(w({ spend: 100, ...funnel }, 3, 291), { daysActive: 1 }));
    expect(r.evidence).toBe("inconclusivo");
    expect(r.status).toBe("aguardar");
    expect(r.cpa.upper!).toBeGreaterThan(80);
    expect(r.confidence).toBe("baixa");
  });

  it("prejuízo comprovado → pausar; vendas sem origem tornam inconclusivo", () => {
    const loss = evaluate(input(w({ spend: 1000, ...funnel }, 2, 194)));
    expect(loss.evidence).toBe("deficitario");
    expect(loss.status).toBe("pausar");
    const unsure = evaluate(input(w({ spend: 1000, ...funnel }, 2, 194, 5)));
    expect(unsure.evidence).toBe("inconclusivo");
    expect(unsure.status).not.toBe("pausar");
  });

  it("CPA muito acima do máximo e pouco provável no equilíbrio → reduzir (sem declarar prejuízo comprovado)", () => {
    const r = evaluate(input(w({ spend: 400, ...funnel }, 2, 194), { dailyBudget: 60 }));
    expect(r.evidence).toBe("inconclusivo");
    expect(r.status).toBe("otimizar");
    const red = r.recommendations.find((x) => x.action === "reduzir")!;
    expect(red).toBeDefined();
    expect(red.justification.join(" ")).toMatch(/chance de ver só 2 venda/);
    // mesmo CPA com pouco gasto (P alta no equilíbrio) → não reage
    const small = evaluate(input(w({ spend: 90, ...funnel }, 1, 97), { daysActive: 3 }));
    expect(small.status).toBe("aguardar");
  });

  it("não escala com tracking quebrado", () => {
    const r = evaluate(input(w({ spend: 750, ...funnel }, 25, 2425), { trackingOk: false }));
    expect(r.status).not.toBe("escalar");
    expect(r.confidence).toBe("baixa");
    expect(r.recommendations[0].action).toBe("corrigir_tracking");
  });

  it("não escala sem margem do produto (CPA máximo padrão)", () => {
    const r = evaluate({ ...input(w({ spend: 750, ...funnel }, 25, 2425)), config: { ...DEFAULT_DECISION_CONFIG } });
    expect(r.signals.map((s) => s.code)).toContain("sem_margem");
    expect(r.status).not.toBe("escalar");
  });

  it("não escala com dados incompletos (ex.: gasto sem cotação)", () => {
    const r = evaluate(input(w({ spend: 750, ...funnel }, 25, 2425), { dataIssues: ["Gasto em USD sem cotação."] }));
    expect(r.status).not.toBe("escalar");
    expect(r.signals.map((s) => s.code)).toContain("dados_incompletos");
  });

  it("otimiza com connect rate baixo (crítico)", () => {
    const r = evaluate(input(w({ spend: 200, linkClicks: 400, landingPageViews: 200, impressions: 20000, reachSum: 15000 }, 4, 360)));
    expect(r.status).toBe("otimizar");
    expect(r.signals.find((s) => s.code === "connect_rate_baixo")?.severity).toBe("critico");
  });
});

describe("metas a partir do produto", () => {
  it("CPA máximo = CPA de equilíbrio (margem real)", () => {
    const c = configFromProduct({ netPerSale: 100, targetCpa: null, maxCpa: null, minRoas: null });
    expect(c.maxCpa).toBe(100);
    expect(c.targetCpa).toBe(70);
    expect(c.breakevenSource).toBe("produto");
  });

  it("desconta impostos e custos variáveis do produto", () => {
    const c = configFromProduct({ price: 120, netPerSale: 100, targetCpa: null, maxCpa: null, minRoas: null, costPct: 0.05, costPerSale: 5 }, { taxRate: 0.1, defaultFeeRate: 0.07 });
    expect(c.breakevenCpa).toBeCloseTo(77, 6); // 100 − 120×(10% + 5%) − 5
    expect(c.maxCpa).toBeCloseTo(77, 6);
  });

  it("CPA máximo definido pelo usuário prevalece", () => {
    const c = configFromProduct({ netPerSale: 100, targetCpa: null, maxCpa: 60, minRoas: null });
    expect(c.maxCpa).toBe(60);
    expect(c.breakevenSource).toBe("configurado");
  });
});
