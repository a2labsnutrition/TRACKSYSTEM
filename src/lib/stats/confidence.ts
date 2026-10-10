import { fmtBRL, fmtDec, fmtPct } from "@/lib/format";
import { coefficientOfVariation, cpaInterval } from "./core";

/**
 * Confiança de um diagnóstico — critérios transparentes, nível final = o PIOR
 * critério aplicável ("elo mais fraco"). Confiança estatística mede o quanto os
 * dados sustentam a conclusão; NÃO é a probabilidade de sucesso futuro.
 */

export type ConfidenceLevel = "baixa" | "moderada" | "alta";

export interface Criterion {
  key: string;
  label: string;
  value: string;
  level: ConfidenceLevel | "n/a";
  rule: string;
}

export interface ConfidenceAssessment {
  level: ConfidenceLevel;
  criteria: Criterion[];
  /** Critérios que derrubaram o nível (para explicar em uma frase). */
  limiting: string[];
  summary: string;
}

export interface ConfidenceInput {
  purchases: number;
  spend: number;
  daysWithSpend: number;
  linkClicks: number;
  /** Fração das vendas pagas do período com origem confirmada ou provável (null = sem vendas). */
  attributionCoverage: number | null;
  trackingOk: boolean;
  /** ROAS (ou compras/R$) por dia — para medir a oscilação. */
  dailyValues?: number[];
}

const RANK: Record<ConfidenceLevel, number> = { baixa: 0, moderada: 1, alta: 2 };

function tier(v: number, alta: number, moderada: number, higherIsBetter = true): ConfidenceLevel {
  if (higherIsBetter) return v >= alta ? "alta" : v >= moderada ? "moderada" : "baixa";
  return v <= alta ? "alta" : v <= moderada ? "moderada" : "baixa";
}

export function assessConfidence(i: ConfidenceInput): ConfidenceAssessment {
  const criteria: Criterion[] = [];

  criteria.push({
    key: "compras",
    label: "Compras no período",
    value: String(i.purchases),
    level: tier(i.purchases, 30, 10),
    rule: "alta ≥ 30 · moderada ≥ 10",
  });

  criteria.push({
    key: "dias",
    label: "Tempo de veiculação",
    value: `${i.daysWithSpend} dia(s) com gasto`,
    level: tier(i.daysWithSpend, 7, 3),
    rule: "alta ≥ 7 dias · moderada ≥ 3 (o leilão varia por dia da semana)",
  });

  criteria.push({
    key: "cliques",
    label: "Cliques no link",
    value: String(i.linkClicks),
    level: tier(i.linkClicks, 1000, 300),
    rule: "alta ≥ 1.000 · moderada ≥ 300",
  });

  const ci = cpaInterval(i.spend, i.purchases);
  const width = ci.lower && ci.upper ? ci.upper / ci.lower : null;
  criteria.push({
    key: "precisao",
    label: "Precisão do CPA (IC 95%)",
    value: ci.point == null ? "sem compras" : `${fmtBRL(ci.lower)} a ${fmtBRL(ci.upper)} (${fmtDec(width, 1)}×)`,
    level: width == null ? "baixa" : tier(width, 1.6, 2.5, false),
    rule: "alta: limite superior ≤ 1,6× o inferior · moderada ≤ 2,5×",
  });

  let attrLevel: ConfidenceLevel | "n/a";
  let attrValue: string;
  if (!i.trackingOk) {
    attrLevel = "baixa";
    attrValue = "rastreamento com problema";
  } else if (i.attributionCoverage == null) {
    attrLevel = "n/a";
    attrValue = "sem vendas para avaliar";
  } else {
    attrLevel = tier(i.attributionCoverage, 0.85, 0.6);
    attrValue = `${fmtPct(i.attributionCoverage, 0)} das vendas com origem identificada`;
  }
  criteria.push({ key: "atribuicao", label: "Qualidade da atribuição", value: attrValue, level: attrLevel, rule: "alta ≥ 85% · moderada ≥ 60% (e rastreamento OK)" });

  const daily = (i.dailyValues ?? []).filter((v) => Number.isFinite(v));
  const cv = daily.length >= 4 ? coefficientOfVariation(daily) : null;
  criteria.push({
    key: "volatilidade",
    label: "Estabilidade diária",
    value: cv == null ? "poucos dias para medir" : `variação de ${fmtPct(cv, 0)} entre os dias`,
    level: cv == null ? "n/a" : tier(cv, 0.35, 0.7, false),
    rule: "coeficiente de variação diário: alta ≤ 35% · moderada ≤ 70% (precisa de 4+ dias)",
  });

  const applicable = criteria.filter((c) => c.level !== "n/a") as Array<Criterion & { level: ConfidenceLevel }>;
  const level = applicable.reduce<ConfidenceLevel>((min, c) => (RANK[c.level] < RANK[min] ? c.level : min), "alta");
  const limiting = applicable.filter((c) => c.level === level && level !== "alta").map((c) => `${c.label.toLowerCase()}: ${c.value}`);
  const summary =
    level === "alta"
      ? "Dados suficientes e estáveis para sustentar a conclusão."
      : `Confiança ${level} porque ${limiting.join("; ")}.`;
  return { level, criteria, limiting, summary };
}

export const CONFIDENCE_NOTE =
  "Confiança indica o quanto os dados sustentam a conclusão (volume, tempo, precisão, atribuição e estabilidade). Não é a probabilidade de a campanha dar certo.";
