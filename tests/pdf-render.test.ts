import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { writeFileSync } from "node:fs";
import { renderPdf } from "@/lib/pdf/render";
import { DEFAULT_THEME } from "@/lib/pdf/types";

describe("render do PDF", () => {
  it("gera PDF com capa, sumário e capítulos (acentos, tabela, checklist, destaque)", async () => {
    const md = "Introdução com **negrito**, *itálico* e acentuação: ação, coração, pão.\n\n## Seção\n- item um\n- item dois\n\n- [ ] tarefa\n- [x] feita\n\n| Exercício | Séries |\n|---|---|\n| Agachamento | 3 |\n\n> **Dica:** beba água.\n\n[QUEBRA DE PÁGINA]\n\n1. passo\n2. outro";
    const buf = await renderPdf(
      { id: "p", title: "Guia Prático de Receitas", brief: "", productId: null, createdAt: "", theme: { ...DEFAULT_THEME, author: "Autora Exemplo", coverSubtitle: "Do básico ao avançado", font: "merriweather" } },
      { chapters: [{ id: "c1", title: "Começando", summary: "", markdown: md }, { id: "c2", title: "Próximos passos", summary: "", markdown: "Texto final." }] },
    );
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(10_000);
    if (process.env.PDF_OUT) writeFileSync(process.env.PDF_OUT, buf);
  }, 60_000);
});
