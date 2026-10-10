import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { angleKey, flowPromptText, nextAdName, normalizeRatio, pickToday, scenesFromPasted, scenesFromScripts, scenePriority, type FlowQueueItem } from "@/lib/creative/flow";
import { angleLessons, type LearnedCreative } from "@/lib/creative/learning";
import { decodeScene, encodeScene } from "@/lib/creative/store";

const item = (o: Partial<FlowQueueItem>): FlowQueueItem => ({
  id: Math.random().toString(36), kitId: null, title: "t", angle: "a", prompt: "p", ratio: "9:16", durationS: 8, variant: "A", hook: null,
  priority: 1000, scheduledFor: "2026-10-10", status: "backlog", assetId: null, createdAt: "2026-10-10T00:00:00Z", ...o,
});

describe("fluxo do Flow", () => {
  it("cenas do kit estruturado viram A e B; markdown editado também é lido", () => {
    const data = { angulos: [{ angulo: "Renda em casa", ganchos: ["Gancho 1"], roteiros: [], prompts_video: [{ cena: "Cozinha", prompt: "Woman baking brigadeiros in a small kitchen", proporcao: "9:16", duracao_s: 8 }] }] };
    const s = scenesFromScripts(data, "structured");
    expect(s.map((x) => x.variant)).toEqual(["A", "B"]);
    expect(s[0]).toMatchObject({ angle: "Renda em casa", ratio: "9:16", durationS: 8, hook: "Gancho 1" });
    const md = "## Ângulo: Presente\n### Ganchos\n1. x\n### Prompts para o Google Flow\n- **Embalagem** (4:5, 6s): Close-up of hands wrapping a gift box with ribbon\n";
    const m = scenesFromScripts(md, "markdown", false);
    expect(m).toHaveLength(1);
    expect(m[0]).toMatchObject({ angle: "Presente", title: "Embalagem", ratio: "4:5", durationS: 6 });
  });
  it("prompt final traz proporção, duração e variação B", () => {
    const t = flowPromptText({ prompt: "A cat", ratio: "1:1", durationS: 8, variant: "B" });
    expect(t).toContain("Aspect ratio 1:1, about 8 seconds");
    expect(t).toContain("Alternate take");
    expect(normalizeRatio("16x9")).toBe("16:9");
    expect(normalizeRatio("weird")).toBe("9:16");
  });
  it("prompts colados: um por parágrafo ou item de lista", () => {
    const s = scenesFromPasted("- A woman cooking pasta in a bright kitchen\n- A man running at sunrise on a beach\n\nShort", "Treino", "4:5");
    expect(s.map((x) => x.prompt)).toEqual(["A woman cooking pasta in a bright kitchen", "A man running at sunrise on a beach"]);
    expect(s[0].ratio).toBe("4:5");
  });
  it("fila de hoje: atrasados contam na capacidade e o backlog entra por prioridade", () => {
    const items = [
      item({ status: "todo", scheduledFor: "2026-10-09" }),
      item({ status: "backlog", priority: 900 }),
      item({ status: "backlog", priority: 1200, id: "top" }),
      item({ status: "done" }),
    ];
    const r = pickToday(items, "2026-10-10", 2);
    expect(r.overdue).toHaveLength(1);
    expect(r.promote.map((x) => x.id)).toEqual(["top"]);
  });
  it("prioridade sobe para ângulo comprovado e A vem antes de B", () => {
    const scores = new Map([[angleKey("Renda em casa"), 2]]);
    expect(scenePriority({ angle: "Renda em casa", variant: "A" }, 0, scores)).toBeGreaterThan(scenePriority({ angle: "Outro", variant: "A" }, 0, scores));
    expect(scenePriority({ angle: "x", variant: "A" }, 0, scores)).toBeGreaterThan(scenePriority({ angle: "x", variant: "B" }, 0, scores));
  });
  it("nome do anúncio segue o padrão e numera em sequência", () => {
    const n = nextAdName({ product: "Doces Lucrativos", angle: "Renda em casa", date: "2026-10-10", existing: ["[docesLucrativos]_rendaEmCasa_amplo_c01_0910", "[docesLucrativos]_rendaEmCasa_amplo_c03_0910", null] });
    expect(n).toBe("[docesLucrativos]_rendaEmCasa_amplo_c04_1010");
  });
  it("cena guardada como JSON volta igual; texto antigo é aceito", () => {
    const s = { title: "T", angle: "A", prompt: "P", ratio: "9:16", durationS: null, variant: "B" as const, hook: "h" };
    expect(decodeScene(encodeScene(s))).toEqual(s);
    expect(decodeScene("um prompt antigo").prompt).toBe("um prompt antigo");
  });
});

describe("ciclo de aprendizado", () => {
  const lc = (angle: string, verdict: LearnedCreative["verdict"], hook: string | null = null): LearnedCreative => ({ assetId: "x", adName: "n", angle, hook, campaignName: "c", verdict, reasons: [], spend: 100, purchases: 1 });
  it("repete ângulo comprovado, abandona o que perde em mais de um criativo e não conclui com pouco dado", () => {
    const { lessons, scores } = angleLessons([
      lc("Renda", "destaque_comprovado", "Fiz R$ 0 no primeiro mês"),
      lc("Renda", "inconclusivo"),
      lc("Medo", "abaixo_comprovado"),
      lc("Medo", "gasto_sem_venda"),
      lc("Novo", "pouco_gasto"),
    ]);
    const by = Object.fromEntries(lessons.map((l) => [l.angle, l]));
    expect(by.Renda.action).toBe("repetir");
    expect(by.Renda.hooks).toEqual(["Fiz R$ 0 no primeiro mês"]);
    expect(by.Medo.action).toBe("abandonar");
    expect(by.Novo.action).toBe("testar_mais");
    expect(lessons[0].angle).toBe("Renda");
    expect(scores.get("medo")).toBe(-2);
  });
  it("prompt manual de novas cenas leva o aprendizado", async () => {
    const { manualFlowPrompt } = await import("@/lib/creative/ai");
    const p = manualFlowPrompt(angleLessons([lc("Renda", "destaque_comprovado", "g1")]).lessons, "Natal");
    expect(p).toContain("Natal");
    expect(p).toContain("g1");
    expect(p).toContain("um por parágrafo");
  });
});
