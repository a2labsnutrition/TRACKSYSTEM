import { describe, expect, it } from "vitest";
import { accuracySummary, dedupeByDay, evaluateOutcome, judge, type OutcomeDay, type OutcomeTargets } from "@/lib/advisor/outcome";
import { addDays } from "@/lib/tz";

const T: OutcomeTargets = { maxCpa: 100, killSpendMultiple: 3, source: "parecer" };
const REPORT_DATE = "2026-05-10";

/** 7 dias antes (até o dia do parecer) + `after` dias depois. */
function series(before: { spend: number; purchases: number }, after: { spend: number; purchases: number }, afterDays = 7): OutcomeDay[] {
  const out: OutcomeDay[] = [];
  for (let i = -6; i <= 0; i++) out.push({ date: addDays(REPORT_DATE, i), spend: before.spend, purchases: before.purchases, revenue: before.purchases * 200 });
  for (let i = 1; i <= afterDays; i++) out.push({ date: addDays(REPORT_DATE, i), spend: after.spend, purchases: after.purchases, revenue: after.purchases * 200 });
  return out;
}

const report = (status: "escalar" | "manter" | "otimizar" | "pausar" | "aguardar", rulesStatus: typeof status | null = status, id = "r1", campaignId = "c1", reportDate = REPORT_DATE) => ({
  id,
  campaignId,
  reportDate,
  status,
  rulesStatus,
});

const TODAY = addDays(REPORT_DATE, 8); // 7 dias completos depois

describe("judge", () => {
  it("escalar/manter acertam quando ficou lucrativo e erram quando ficou deficitário", () => {
    expect(judge("escalar", "lucrativo")).toBe("acertou");
    expect(judge("manter", "deficitario")).toBe("errou");
  });
  it("pausar acerta quando ficou deficitário", () => {
    expect(judge("pausar", "deficitario")).toBe("acertou");
    expect(judge("pausar", "lucrativo")).toBe("errou");
  });
  it("otimizar/aguardar e campanha sem gasto não são avaliáveis", () => {
    expect(judge("otimizar", "lucrativo")).toBe("nao_avaliavel");
    expect(judge("aguardar", "deficitario")).toBe("nao_avaliavel");
    expect(judge("escalar", "sem_gasto")).toBe("nao_avaliavel");
  });
});

describe("evaluateOutcome", () => {
  it("aguarda até ter o mínimo de dias completos depois do parecer (hoje não conta)", () => {
    const o = evaluateOutcome(report("escalar"), series({ spend: 100, purchases: 2 }, { spend: 100, purchases: 2 }), T, addDays(REPORT_DATE, 3));
    expect(o.daysObserved).toBe(2);
    expect(o.ready).toBe(false);
    expect(o.consultant).toBe("aguardando");
  });

  it("escalar com CPA claramente abaixo do máximo e orçamento aumentado → acertou e seguido", () => {
    // depois: R$ 200/dia, 5 vendas/dia → CPA R$ 40, 35 vendas (IC bem abaixo de R$ 100)
    const o = evaluateOutcome(report("escalar"), series({ spend: 100, purchases: 2 }, { spend: 200, purchases: 5 }), T, TODAY);
    expect(o.ready).toBe(true);
    expect(o.after.days).toBe(7);
    expect(o.after.cpa).toBe(40);
    expect(o.evidence).toBe("lucrativo");
    expect(o.consultant).toBe("acertou");
    expect(o.followed).toBe("sim");
  });

  it("CPA perto do máximo com poucas vendas → inconclusivo (não declara acerto sem estatística)", () => {
    const o = evaluateOutcome(report("manter"), series({ spend: 100, purchases: 1 }, { spend: 90, purchases: 1 }), T, TODAY);
    expect(o.after.cpa).toBe(90);
    expect(o.evidence).toBe("inconclusivo");
    expect(o.consultant).toBe("inconclusivo");
  });

  it("gasto alto sem venda nenhuma depois → deficitário: pausar acertou, mas não foi seguido", () => {
    const o = evaluateOutcome(report("pausar", "manter"), series({ spend: 100, purchases: 0 }, { spend: 100, purchases: 0 }), T, TODAY);
    expect(o.evidence).toBe("deficitario");
    expect(o.consultant).toBe("acertou");
    expect(o.rules).toBe("errou");
    expect(o.followed).toBe("nao");
  });

  it("campanha pausada depois do parecer → pausar foi seguido, mas não dá para avaliar", () => {
    const o = evaluateOutcome(report("pausar"), series({ spend: 100, purchases: 0 }, { spend: 0, purchases: 0 }), T, TODAY);
    expect(o.evidence).toBe("sem_gasto");
    expect(o.consultant).toBe("nao_avaliavel");
    expect(o.followed).toBe("sim");
  });

  it("detecta melhora estatística de compras por real gasto", () => {
    const o = evaluateOutcome(report("otimizar"), series({ spend: 100, purchases: 0 }, { spend: 100, purchases: 3 }), T, TODAY);
    expect(o.trend?.direction).toBe("melhorou");
    expect(o.consultant).toBe("nao_avaliavel");
  });
});

describe("accuracySummary", () => {
  it("conta 1 parecer por campanha por dia e mede o acerto de cada lado", () => {
    const good = series({ spend: 100, purchases: 2 }, { spend: 200, purchases: 5 });
    const bad = series({ spend: 100, purchases: 0 }, { spend: 100, purchases: 0 });
    const outcomes = [
      evaluateOutcome(report("escalar", "escalar", "a", "c1"), good, T, TODAY),
      evaluateOutcome(report("escalar", "escalar", "a-dup", "c1"), good, T, TODAY), // mesmo dia: ignorado
      evaluateOutcome(report("pausar", "manter", "b", "c2"), bad, T, TODAY),
      evaluateOutcome(report("manter", "pausar", "c", "c3"), bad, T, TODAY),
    ];
    expect(dedupeByDay(outcomes)).toHaveLength(3);
    const s = accuracySummary(outcomes);
    expect(s.total).toBe(3);
    expect(s.consultant.acertos).toBe(2);
    expect(s.consultant.erros).toBe(1);
    expect(s.rules.acertos).toBe(2);
    expect(s.rules.erros).toBe(1);
    expect(s.consultant.rate).toBeCloseTo(2 / 3);
    expect(s.disagreements).toEqual({ consultantRight: 1, rulesRight: 1, undecided: 0 });
    expect(s.byStatus.find((x) => x.status === "manter")?.board.erros).toBe(1);
  });
});
