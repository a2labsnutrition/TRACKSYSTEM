import { describe, expect, it } from "vitest";
import {
  binomialTwoSided, compareRates, cpaInterval, poissonInterval, probZeroPurchases, purchasesToConclude, robustZ, spendForZeroProbability, wilson,
} from "@/lib/stats/core";

describe("estatística", () => {
  it("intervalo exato de Poisson bate com tabelas (Garwood)", () => {
    const z = poissonInterval(0);
    expect(z.lower).toBe(0);
    expect(z.upper).toBeCloseTo(3.689, 2);
    const t = poissonInterval(3);
    expect(t.lower).toBeCloseTo(0.619, 2);
    expect(t.upper).toBeCloseTo(8.767, 2);
    const ten = poissonInterval(10);
    expect(ten.lower).toBeCloseTo(4.795, 2);
    expect(ten.upper).toBeCloseTo(18.39, 1);
  });

  it("CPA com 3 compras e R$ 100 tem intervalo largo", () => {
    const c = cpaInterval(100, 3);
    expect(c.point).toBeCloseTo(33.33, 2);
    expect(c.lower).toBeCloseTo(11.41, 1);
    expect(c.upper).toBeCloseTo(161.6, 0);
    const zero = cpaInterval(100, 0);
    expect(zero.point).toBeNull();
    expect(zero.upper).toBeNull();
    expect(zero.lower).toBeCloseTo(27.1, 1);
  });

  it("probabilidade de zero compras", () => {
    expect(probZeroPurchases(100, 50)).toBeCloseTo(Math.exp(-2), 6);
    expect(spendForZeroProbability(50, 0.05)).toBeCloseTo(149.79, 1);
  });

  it("compras necessárias para concluir", () => {
    // CPA atual 50% do equilíbrio: poucas compras bastam
    const k = purchasesToConclude(25, 50)!;
    expect(k).toBeGreaterThan(3);
    expect(k).toBeLessThan(20);
    // Muito perto do equilíbrio: inconclusivo
    expect(purchasesToConclude(50, 50.5)).toBeNull();
  });

  it("Wilson e teste binomial", () => {
    const w = wilson(20, 1000)!;
    expect(w.lower).toBeCloseTo(0.013, 3);
    expect(w.upper).toBeCloseTo(0.0307, 3);
    expect(binomialTwoSided(5, 10, 0.5)).toBeCloseTo(1, 5);
    expect(binomialTwoSided(0, 10, 0.5)).toBeCloseTo(0.00195, 4);
  });

  it("compara taxas: mais gasto não é prova de superioridade", () => {
    // Criativo A: 3 compras com R$ 71; resto: 0 com R$ 29 -> não significativo
    const r = compareRates(3, 71.5, 0, 28.5);
    expect(r.pValue).toBeGreaterThan(0.05);
    // 30 x 5 compras com o mesmo gasto -> significativo
    expect(compareRates(30, 500, 5, 500).pValue).toBeLessThan(0.001);
  });

  it("z robusto ignora dias atípicos na base", () => {
    expect(robustZ(50, [20, 21, 19, 22, 20, 80])).toBeGreaterThan(5);
    expect(robustZ(21, [20, 21, 19, 22])).toBeLessThan(1);
  });
});
