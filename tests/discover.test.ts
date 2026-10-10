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
