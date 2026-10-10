import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { fallbackParecer } from "@/lib/advisor/fallback";
import { ParecerSchema } from "@/lib/advisor/schema";
import { buildSnapshot } from "@/lib/advisor/snapshot";
import { campaignDetail, campaignRows, overview } from "@/lib/analytics";
import { CasoRealRepository } from "@/lib/data/demo/caso-real";
import { INSUFFICIENT_SCALE } from "@/lib/decision/rules";
import { resolvePeriod } from "@/lib/tz";

/**
 * Caso real da auditoria: conta em US$, orçamento US$ 20/dia (~R$ 100), 5 criativos
 * (um com US$ 13), 3 vendas de R$ 97 + 2 order bumps de R$ 19,90, 1º dia, tracking incompleto.
 */
const repo = new CasoRealRepository();
const period = resolvePeriod("America/Cuiaba", "today");

describe("caso real — números", () => {
  it("financeiro: bruto R$ 330,80, faturamento − tráfego R$ 230,80, ROAS 3,308, CPA R$ 33,33", async () => {
    const o = await overview(repo, period);
    const f = o.cur.fin;
    expect(f.adSpend).toBe(100);
    expect(f.grossApproved).toBeCloseTo(330.8, 2);
    expect(f.mainRevenue).toBeCloseTo(291, 2);
    expect(f.bumpRevenue).toBeCloseTo(39.8, 2);
    expect(f.grossMinusAds).toBeCloseTo(230.8, 2);
    expect(f.roasGross).toBeCloseTo(3.308, 3);
    expect(f.cpa).toBeCloseTo(33.33, 2);
    expect(f.mainPurchases).toBe(3); // bumps NÃO contam como compra
    expect(f.bumpOrders).toBe(2);
  });

  it("lucro de contribuição < faturamento − tráfego (taxas da Cakto) e com observações honestas", async () => {
    const f = (await overview(repo, period)).cur.fin;
    expect(f.fees).toBeGreaterThan(0);
    expect(f.contribution).toBeLessThan(f.grossMinusAds);
    expect(f.notes.join(" ")).toMatch(/câmbio estimado/);
    expect(f.notes.join(" ")).toMatch(/Taxas da Cakto estimadas/);
    expect(f.notes.join(" ")).toMatch(/não inclui custos fixos/);
  });

  it("câmbio: gasto em US$ convertido e marcado como estimado (nunca US$ como R$)", async () => {
    const o = await overview(repo, period);
    expect(o.cur.fx.estimated).toBe(true);
    expect(o.cur.fx.missing).toBe(false);
    expect(o.cur.meta.spend).toBe(100); // US$ 20 × 5,00
  });

  it("Meta e Cakto aparecem separados (Meta 2 compras × Cakto 3 vendas)", async () => {
    const o = await overview(repo, period);
    expect(o.cur.meta.purchases).toBe(2);
    expect(o.cur.fin.mainPurchases).toBe(3);
    expect(o.cur.attribution).toMatchObject({ confirmada: 0, provavel: 0, desconhecida: 3, total: 3, coverage: 0 });
  });
});

describe("caso real — comportamento", () => {
  it("não recomenda escalonamento e diz que os dados são insuficientes", async () => {
    const [row] = await campaignRows(repo, period);
    const d = row.decision;
    expect(d.status).not.toBe("escalar");
    expect(d.status).toBe("aguardar");
    expect(d.headline).toContain(INSUFFICIENT_SCALE);
    expect(d.confidence).toBe("baixa");
    expect(d.recommendations.map((r) => r.action)).not.toContain("aumentar_gradual");
    expect(d.recommendations[0].action).toBe("corrigir_tracking");
    expect(row.daysActive).toBe(1);
    expect(row.config.breakevenSource).toBe("produto");
  });

  it("não atribui as vendas ao criativo de maior gasto", async () => {
    const d = (await campaignDetail(repo, "120200000000000001", period))!;
    const top = [...d.creatives.ads].sort((a, b) => b.meta.spend - a.meta.spend)[0];
    expect(top.name).toMatch(/CR01/);
    expect(top.meta.spend).toBe(65); // US$ 13 × 5,00
    expect(top.purchases).toBe(0);
    expect(top.verdict).not.toBe("destaque_comprovado");
    expect(top.distributionNote).toMatch(/NÃO foram atribuídas a ele/);
    expect(d.creatives.ads.every((a) => a.verdict !== "destaque_comprovado")).toBe(true);
    expect(d.creatives.notes.join(" ")).toMatch(/sem origem/);
    expect(d.unattributedPool).toBe(3);
  });

  it("resultado da campanha é um intervalo (não um prejuízo) enquanto há vendas sem origem", async () => {
    const d = (await campaignDetail(repo, "120200000000000001", period))!;
    expect(d.k.fin.contribution).toBe(-100); // só vendas com origem: nenhuma
    expect(d.finWithPool?.grossApproved).toBeCloseTo(330.8, 2); // se todas as sem origem fossem daqui
    expect(d.finWithPool?.cpa).toBeCloseTo(33.33, 2);
    expect(d.row.decision.status).not.toBe("pausar");
  });

  it("parecer automático (sem IA) mantém a cautela e lista o que não sabemos", async () => {
    const d = (await campaignDetail(repo, "120200000000000001", period))!;
    const snap = buildSnapshot(d, await repo.health(), null, period.to);
    const p = fallbackParecer(snap);
    expect(ParecerSchema.safeParse(p).success).toBe(true);
    expect(p.veredito.status).not.toBe("escalar");
    expect(p.veredito.confianca).toBe("baixa");
    expect(p.o_que_nao_sabemos.join(" ")).toMatch(/sem origem/);
    expect(p.o_que_nao_sabemos.join(" ")).toMatch(/câmbio/);
    expect(JSON.stringify(p)).not.toMatch(/20%/);
    // o snapshot enviado à IA separa o que é da campanha (nada comprovado) do que está sem origem
    expect(snap.financeiro_periodo.faturamento_bruto_aprovado_rs).toBe(0);
    expect(snap.atribuicao_periodo.vendas_sem_origem_no_workspace).toBe(3);
    expect(snap.atribuicao_periodo.faturamento_sem_origem_no_workspace_rs).toBeCloseTo(330.8, 2);
    expect(snap.atribuicao_periodo.regra).toMatch(/nem ao de maior gasto/);
  });
});
