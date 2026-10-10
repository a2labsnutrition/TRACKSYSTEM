import { describe, expect, it } from "vitest";
import { parseAdLibraryUrl } from "@/lib/integrations/adlibrary";
import { findNiche, NICHES } from "@/lib/discover/niches";
import { computeNicheScore, scalingSignals } from "@/lib/discover/score";
import { latestSections, MemoryDiscoverStore } from "@/lib/discover/store";
import type { AdReference, NicheSeed } from "@/lib/discover/types";

const today = "2026-10-10";
const ref = (o: Partial<AdReference>): AdReference => ({
  id: Math.random().toString(36), source: "manual", sourceUrl: null, libraryId: null, nicheSlug: "tecnologia-ia", subnicheSlug: null,
  advertiser: null, format: "video", firstSeen: null, variations: null, country: null, price: null, copy: null, hook: null, angle: null,
  cta: null, landingType: null, landingUrl: null, notes: null, tags: [], analysis: null, collectedAt: today, ...o,
});
const seed: NicheSeed = { escala_estimada: 70, saturacao_estimada: 60, justificativa: "x", subnichos_em_alta: [], angulos: [], estruturas_oferta: [], formatos_que_mais_aparecem: [], alertas: [], generatedAt: today, model: "m" };

describe("catálogo de nichos", () => {
  it("tem os nichos do escopo, com subnichos e slugs únicos", () => {
    expect(NICHES.length).toBeGreaterThanOrEqual(30);
    expect(new Set(NICHES.map((n) => n.slug)).size).toBe(NICHES.length);
    for (const n of NICHES) expect(new Set(n.subniches.map((s) => s.slug)).size).toBe(n.subniches.length);
    expect(findNiche("emagrecimento")?.policy.level).toBe("alto");
  });
});

describe("score de potencial", () => {
  const n = findNiche("tecnologia-ia")!;
  it("sem referências nem IA: parcial, sinais de mercado sem dados", () => {
    const s = computeNicheScore(n, [], null, today);
    expect(s.partial).toBe(true);
    expect(s.components.find((c) => c.key === "escala")?.source).toBe("sem_dados");
    expect(s.total).not.toBeNull();
  });
  it("com estimativa da IA: usa e rotula como estimativa", () => {
    const s = computeNicheScore(n, [], seed, today);
    expect(s.partial).toBe(false);
    expect(s.components.find((c) => c.key === "escala")?.source).toBe("estimativa_ia");
  });
  it("com 3+ referências: sinais de escala MEDIDOS (tempo no ar, variações, anunciantes por ângulo)", () => {
    const refs = [
      ref({ advertiser: "A", firstSeen: "2026-08-01", variations: 8, angle: "serviços" }),
      ref({ advertiser: "B", firstSeen: "2026-08-20", variations: 6, angle: "serviços" }),
      ref({ advertiser: "C", firstSeen: "2026-10-05", variations: 1, angle: "do zero" }),
    ];
    const sig = scalingSignals(refs, today);
    expect(sig.longRunning).toBe(2);
    expect(sig.maxAdvertisersPerAngle).toBe(2);
    const s = computeNicheScore(n, refs, seed, today);
    const esc = s.components.find((c) => c.key === "escala")!;
    expect(esc.source).toBe("medido");
    expect(esc.value).toBeGreaterThan(0);
    // saturação ainda estimada (precisa de 5+)
    expect(s.components.find((c) => c.key === "saturacao")?.source).toBe("estimativa_ia");
  });
  it("risco de política alto pesa contra", () => {
    const low = computeNicheScore(findNiche("vendas")!, [], seed, today).total!;
    const high = computeNicheScore(findNiche("investimentos")!, [], seed, today).total!;
    expect(low).toBeGreaterThan(high - 30); // não é só o risco, mas ele conta
    expect(computeNicheScore(findNiche("investimentos")!, [], seed, today).components.find((c) => c.key === "risco")!.value).toBe(85);
  });
});

describe("Biblioteca de Anúncios (link)", () => {
  it("lê o ID do anúncio do link da Biblioteca e aceita outros links sem ID", () => {
    expect(parseAdLibraryUrl("https://www.facebook.com/ads/library/?id=1234567890123")?.libraryId).toBe("1234567890123");
    expect(parseAdLibraryUrl("https://instagram.com/p/abc")?.libraryId).toBeNull();
    expect(parseAdLibraryUrl("não é link")).toBeNull();
  });
});

describe("armazenamento (demo)", () => {
  it("versiona seções do kit e devolve a última", async () => {
    const st = new MemoryDiscoverStore();
    const kit = await st.createKit({ title: "K", nicheSlug: "culinaria", subnicheSlug: null, referenceIds: [], inputs: {} });
    expect(await st.saveSection(kit.id, "offer", "structured", { a: 1 }, null)).toBe(1);
    expect(await st.saveSection(kit.id, "offer", "markdown", "editado", "ajuste")).toBe(2);
    const k = await st.getKit(kit.id);
    expect(latestSections(k!.sections).get("offer")?.version).toBe(2);
    expect(k!.sections.length).toBe(2);
  });
});

import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import * as S from "@/lib/discover/schemas";

describe("schemas da IA", () => {
  it("todos convertem para saída estruturada", () => {
    for (const schema of [S.ReferenceAnalysisSchema, S.NicheSeedSchema, S.PlanSchema, S.OfferSchema, S.LandingSchema, S.VslSchema, S.AngleScriptsSchema, S.ComplianceRewriteSchema]) {
      expect(() => betaZodOutputFormat(schema)).not.toThrow();
    }
  });
});

import { buildCampaignStructure } from "@/lib/discover/structure";
import { scanText, scanValue } from "@/lib/discover/compliance";
import { buildLovablePrompt, lovableUrl, LOVABLE_MAX_PROMPT } from "@/lib/discover/lovable";
import { buildLandingHtml, miniMarkdown } from "@/lib/discover/landing-html";
import type { LandingContent } from "@/lib/discover/schemas";

describe("estrutura da campanha", () => {
  it("orçamento de teste = 3× CPA máximo por criativo e nomenclatura no padrão", () => {
    const s = buildCampaignStructure({ productName: "Fature com IA", price: 97, maxCpa: 60, feeRate: 0.05, taxRate: 0, dailyBudget: 100, angles: ["Renda extra", "Praticidade", "Medo de ficar para trás"], date: "2026-10-10" });
    expect(s.teste.orcamentoPorCriativo).toBe(180);
    expect(s.teste.totalTeste).toBe(180 * 9);
    expect(s.teste.diasEstimados).toBe(17);
    expect(s.teste.conjuntos[0].anuncios[0]).toBe("[fatureComIa]_rendaExtra_amplo_c01_1010");
    expect(s.teste.conjuntos[2].anuncios[2]).toBe("[fatureComIa]_medoDeFicarPara_amplo_c09_1010");
    expect(s.utms).toContain("utm_content={{ad.name}}|{{ad.id}}");
    expect(s.cpaMaximoOrigem).toBe("informado");
  });
  it("sem CPA usa o preço (com aviso) e sem preço não inventa número", () => {
    const a = buildCampaignStructure({ productName: "X", price: 100, maxCpa: null, feeRate: 0.1, taxRate: 0.05, dailyBudget: null, angles: [], date: "2026-10-10" });
    expect(a.cpaMaximo).toBe(85);
    expect(a.cpaMaximoOrigem).toBe("estimado_pelo_preco");
    expect(a.avisos.length).toBe(1);
    const b = buildCampaignStructure({ productName: "X", price: null, maxCpa: null, feeRate: 0.1, taxRate: 0, dailyBudget: 50, angles: [], date: "2026-10-10" });
    expect(b.cpaMaximo).toBeNull();
    expect(b.teste.totalTeste).toBeNull();
  });
});

describe("verificador de políticas", () => {
  it("sinaliza promessas arriscadas e ignora texto limpo", () => {
    const rules = (t: string) => scanText(t, "x").map((f) => f.rule);
    expect(rules("Ganhe R$ 5.000 por mês com IA")).toContain("renda_valor");
    expect(rules("Perca 10 kg em 30 dias")).toContain("saude_peso");
    expect(rules("Veja o antes e depois das alunas")).toContain("antes_depois");
    expect(rules("Você está endividado e cansado?")).toContain("atributo_pessoal");
    expect(rules("Resultado garantido ou seu dinheiro de volta")).toContain("resultado_garantido");
    expect(rules("Só hoje: últimas 3 vagas")).toContain("urgencia");
    expect(rules("Aprenda a criar receitas saudáveis com garantia de 7 dias")).toEqual([]);
  });
  it("varre objetos, mostra o trecho original e remove duplicados", () => {
    const flags = scanValue({ a: ["Emagreça 5 kg já", "Emagreça 5 kg já"], b: { c: "ok" } }, "Oferta");
    expect(flags).toHaveLength(1);
    expect(flags[0].excerpt).toContain("Emagreça 5 kg");
    expect(flags[0].section).toBe("Oferta");
  });
});

const landing: LandingContent = {
  tipo_pagina: "Página curta",
  paleta: { primaria: "#1d4ed8", fundo: "#ffffff", texto: "#111111", destaque: "#facc15" },
  tipografia: "Inter",
  cta_texto: "Quero começar",
  secoes: [
    { titulo: "Aprenda <hoje>", objetivo: "gancho", copy: "Texto **forte**\n\n- item 1\n- item 2\n\n[DEPOIMENTO REAL DE ALUNO]", tem_botao_checkout: true },
    { titulo: "Garantia", objetivo: "reduzir risco", copy: "7 dias.", tem_botao_checkout: false },
  ],
  provas_a_coletar: [],
};

describe("Lovable e HTML", () => {
  const snippet = '<script src="https://app.exemplo.com/t.js" data-site="s_1" async></script>';
  it("prompt leva script no head, links de checkout com data-track e não pede Pixel", () => {
    const p = buildLovablePrompt({ landing, productName: "Curso", checkoutUrl: "https://pay.cakto.com.br/abc", trackingSnippet: snippet });
    expect(p).toContain(snippet);
    expect(p).toContain('<a href="https://pay.cakto.com.br/abc" data-track="checkout">Quero começar</a>');
    expect(p).toMatch(/Não adicione código de Pixel/);
    expect(p).toContain("[DEPOIMENTO REAL DE ALUNO]");
    expect(lovableUrl(p).startsWith("https://lovable.dev/#prompt=")).toBe(true);
    expect(decodeURIComponent(lovableUrl(p).split("#prompt=")[1])).toBe(p);
  });
  it("prompt respeita o limite de 50.000 caracteres", () => {
    const big = { ...landing, secoes: [{ ...landing.secoes[0], copy: "a".repeat(60_000) }] };
    expect(buildLovablePrompt({ landing: big, productName: "C", checkoutUrl: null, trackingSnippet: null }).length).toBeLessThanOrEqual(LOVABLE_MAX_PROMPT);
  });
  it("HTML escapa conteúdo, inclui o script e os botões de checkout", () => {
    const h = buildLandingHtml({ landing, productName: "Curso", checkoutUrl: "https://pay.cakto.com.br/abc", trackingSnippet: snippet });
    expect(h).toContain(snippet);
    expect(h).toContain("Aprenda &lt;hoje&gt;");
    expect(h).toContain('href="https://pay.cakto.com.br/abc" data-track="checkout"');
    expect(h.match(/data-track="checkout"/g)).toHaveLength(1);
    const bad = buildLandingHtml({ landing, productName: "C", checkoutUrl: "javascript:alert(1)", trackingSnippet: null });
    expect(bad).not.toContain("javascript:");
  });
  it("markdown simples", () => {
    expect(miniMarkdown("Olá **mundo**\n\n- a\n- b")).toBe("<p>Olá <strong>mundo</strong></p>\n<ul><li>a</li><li>b</li></ul>");
  });
});

import { BUY_BUTTON, landingMarkdown, sectionToMarkdown } from "@/lib/discover/markdown";
import { splitMarkdownSections } from "@/lib/discover/landing-html";
import { adsManagerSteps } from "@/lib/discover/structure";

describe("markdown do kit", () => {
  it("página vira markdown com botão e volta em seções no HTML", () => {
    const md = landingMarkdown(landing);
    expect(md).toContain(`## Aprenda <hoje>`);
    expect(md).toContain(BUY_BUTTON);
    expect(splitMarkdownSections(md).map((s) => s.titulo)).toEqual(["", "Aprenda <hoje>", "Garantia", "Provas reais a coletar"]);
    const h = buildLandingHtml({ landing: md, productName: "C", checkoutUrl: "https://pay.cakto.com.br/x", trackingSnippet: null });
    expect(h.match(/data-track="checkout"/g)).toHaveLength(1);
    expect(h).not.toContain("<hoje>");
  });
  it("versão editada (markdown) é exibida como está e o prompt do Lovable usa o texto", () => {
    expect(sectionToMarkdown("offer", { format: "markdown", data: "## Minha oferta" })).toBe("## Minha oferta");
    const p = buildLovablePrompt({ landing: `## Topo\n\n${BUY_BUTTON}`, productName: "C", checkoutUrl: "https://pay.cakto.com.br/x", trackingSnippet: null });
    expect(p).toContain('<a href="https://pay.cakto.com.br/x" data-track="checkout">');
    expect(p).toContain("## Topo");
  });
  it("passo a passo do Gerenciador usa nomes, UTMs e Pixel", () => {
    const s = buildCampaignStructure({ productName: "Curso X", price: 100, maxCpa: 50, feeRate: 0, taxRate: 0, dailyBudget: 90, angles: ["Dor"], date: "2026-10-10" });
    const steps = adsManagerSteps(s, { pageUrl: "https://meusite.com", pixelId: "123" }).join("\n");
    expect(steps).toContain("[cursoX]_vendas_teste_1010");
    expect(steps).toContain("**123**");
    expect(steps).toContain(s.utms);
  });
});

import { vi } from "vitest";
vi.mock("server-only", () => ({}));

describe("prompt para IA grátis", () => {
  it("leva regras, dados do kit, tarefa e formato markdown que volta para o kit", async () => {
    const { manualPrompt, manualCompliancePrompt } = await import("@/lib/discover/ai");
    const ctx = { nicheSlug: "culinaria", subnicheSlug: "confeitaria", inputs: { productName: "Doces Lucrativos", price: 47 }, refs: [], plan: "## Ângulos\n### 1. Renda em casa", offer: null };
    const p = manualPrompt("scripts", ctx, ["Renda em casa", "Presente"]);
    expect(p).toContain("Nunca invente dados");
    expect(p).toContain('"Renda em casa", "Presente"');
    expect(p).toContain("Doces Lucrativos");
    expect(p).toContain("markdown simples");
    expect(manualPrompt("landing", ctx)).toContain("[BOTÃO DE COMPRA]");
    expect(manualCompliancePrompt([{ trecho: "Ganhe R$ 5.000", regra: "renda", secao: "Oferta" }], ctx)).toContain("Ganhe R$ 5.000");
  });
});
