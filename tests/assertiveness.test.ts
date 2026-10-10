import { describe, expect, it } from "vitest";
import { assessAds, type AdSignalsInput } from "@/lib/creative/assertiveness";

const ad = (o: Partial<AdSignalsInput>): AdSignalsInput => ({ id: "x", impressions: 5000, isVideo: true, verdict: "inconclusivo", hookRate: 0.3, holdRate: 0.3, ctrLink: 0.01, connectRate: 0.8, fatigued: false, ...o });

describe("assertividade dos anúncios", () => {
  it("compara com a mediana da campanha e usa o veredicto de vendas primeiro", () => {
    const r = assessAds([
      ad({ id: "a", hookRate: 0.45, holdRate: 0.45, ctrLink: 0.02 }),
      ad({ id: "b" }),
      ad({ id: "c", hookRate: 0.15, holdRate: 0.15, ctrLink: 0.005 }),
      ad({ id: "d", verdict: "destaque_comprovado", hookRate: 0.15 }),
      ad({ id: "e", impressions: 300 }),
    ]);
    expect(r.get("a")!.level).toBe("promissor");
    expect(r.get("a")!.strengths.length).toBe(3);
    expect(r.get("b")!.level).toBe("na_media");
    expect(r.get("c")!.level).toBe("fraco");
    expect(r.get("c")!.weaknesses.join(" ")).toContain("troque o início");
    expect(r.get("d")!.level).toBe("vendendo_acima");
    expect(r.get("e")!.level).toBe("sem_dados");
    expect(r.get("e")!.signals).toEqual([]);
  });
  it("imagem não é avaliada por gancho/retenção; fadiga vira ponto fraco", () => {
    const r = assessAds([ad({ id: "i", isVideo: false, hookRate: null, holdRate: null, fatigued: true }), ad({ id: "j", isVideo: false, hookRate: null, holdRate: null })]);
    expect(r.get("i")!.signals.map((s) => s.key)).toEqual(["ctr", "connect"]);
    expect(r.get("i")!.weaknesses.join(" ")).toContain("fadiga");
  });
});
