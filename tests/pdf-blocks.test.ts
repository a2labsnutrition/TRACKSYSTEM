import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { estimatePages, PAGE_BREAK, parseBlocks, parseInline, runsText } from "@/lib/pdf/blocks";
import { normalizeContent, normalizeTheme } from "@/lib/pdf/types";

describe("blocos do PDF", () => {
  it("lê todos os tipos de bloco", () => {
    const b = parseBlocks(`## Título\nTexto **forte** e [site](https://ex.com).\n\n- a\n- b\n\n1. um\n2. dois\n\n- [ ] fazer\n- [x] feito\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n> **Dica:** use sal.\n\n> Uma citação\n\n![Bolo](https://ex.com/b.png)\n\n${PAGE_BREAK}`);
    expect(b.map((x) => x.type)).toEqual(["heading", "paragraph", "list", "list", "checklist", "table", "callout", "quote", "image", "pagebreak"]);
    const cl = b[4] as Extract<(typeof b)[number], { type: "checklist" }>;
    expect(cl.items.map((i) => i.checked)).toEqual([false, true]);
    const co = b[6] as Extract<(typeof b)[number], { type: "callout" }>;
    expect(co.label).toBe("Dica");
    expect(runsText(co.runs)).toBe("use sal.");
  });
  it("links e imagens só com http(s); estilos inline", () => {
    const r = parseInline("**a** *b* `c` [x](javascript:alert(1)) [y](https://ok.com)");
    expect(r.find((x) => x.text === "a")?.bold).toBe(true);
    expect(r.find((x) => x.text === "b")?.italic).toBe(true);
    expect(r.find((x) => x.text === "c")?.code).toBe(true);
    expect(r.find((x) => x.text === "x")?.href).toBeUndefined();
    expect(r.find((x) => x.text === "y")?.href).toBe("https://ok.com");
    expect(parseBlocks("![x](javascript:1)")).toEqual([]);
  });
  it("não confunde snake_case com itálico", () => {
    expect(parseInline("utm_source_x").every((x) => !x.italic)).toBe(true);
  });
  it("estima páginas e normaliza tema/conteúdo", () => {
    expect(estimatePages(["palavra ".repeat(840)])).toBe(2);
    expect(normalizeTheme({ primary: "red", font: "comic" as never }).primary).toBe("#1d4ed8");
    expect(normalizeTheme({ font: "merriweather" }).font).toBe("merriweather");
    expect(normalizeContent({ chapters: [{ title: "A" }, null] }).chapters).toEqual([{ id: "c1", title: "A", summary: "", markdown: "" }]);
  });
  it("sumário colado da IA grátis", async () => {
    const { parseOutlineText } = await import("@/lib/pdf/prompts");
    expect(parseOutlineText("1. Começando — o básico\n2. **Receitas**: as principais\nCapítulo 3: Dicas finais")).toEqual([
      { title: "Começando", summary: "o básico" },
      { title: "Receitas", summary: "as principais" },
      { title: "Dicas finais", summary: "" },
    ]);
  });
});

describe("imagens do Storage", () => {
  it("aceita storage:, lista os caminhos e resolve para URL assinada", async () => {
    const { storageImagePaths, resolveStorageImages } = await import("@/lib/pdf/blocks");
    const md = "![Capa](storage:ws1/img/a.png)\n\n![x](storage:ws1/img/b.png)";
    expect(parseBlocks(md)[0]).toMatchObject({ type: "image", src: "storage:ws1/img/a.png" });
    expect(storageImagePaths([md])).toEqual(["ws1/img/a.png", "ws1/img/b.png"]);
    const r = resolveStorageImages(md, new Map([["ws1/img/a.png", "https://s/a"]]));
    expect(r).toContain("![Capa](https://s/a)");
    expect(r).toContain("arquivo não encontrado");
  });
});

describe("sumário", () => {
  it("mantém o texto dos capítulos de mesmo título e cria ids novos", async () => {
    const { mergeOutline } = await import("@/lib/pdf/types");
    const r = mergeOutline([{ id: "c1", title: "Começando", summary: "a", markdown: "TEXTO" }, { id: "c2", title: "Fim", summary: "", markdown: "X" }], [
      { title: "Introdução", summary: "nova" },
      { title: "começando", summary: "" },
    ]);
    expect(r).toEqual([
      { id: "c3", title: "Introdução", summary: "nova", markdown: "" },
      { id: "c1", title: "começando", summary: "a", markdown: "TEXTO" },
    ]);
  });
});
