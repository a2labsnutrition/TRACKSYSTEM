/** Estúdio de PDF: projetos (briefing + tema) e versões do conteúdo. */

export type PdfFont = "inter" | "merriweather";

export interface PdfTheme {
  template: string;
  font: PdfFont;
  primary: string;
  accent: string;
  pageSize: "A4" | "LETTER";
  coverSubtitle: string;
  author: string;
  header: string;
  footer: string;
  showToc: boolean;
  pageNumbers: boolean;
}

export interface PdfChapter {
  id: string;
  title: string;
  /** Resumo do sumário (o que o capítulo cobre). */
  summary: string;
  markdown: string;
}

export interface PdfContent {
  chapters: PdfChapter[];
}

export interface PdfProject {
  id: string;
  title: string;
  brief: string;
  theme: PdfTheme;
  productId: string | null;
  createdAt: string;
}

export interface PdfVersion {
  id: string;
  projectId: string;
  version: number;
  content: PdfContent;
  note: string | null;
  pdfPath: string | null;
  createdAt: string;
}

export const DEFAULT_THEME: PdfTheme = {
  template: "guia",
  font: "inter",
  primary: "#1d4ed8",
  accent: "#f59e0b",
  pageSize: "A4",
  coverSubtitle: "",
  author: "",
  header: "",
  footer: "",
  showToc: true,
  pageNumbers: true,
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Tema vindo do banco/formulário, com valores seguros. */
export function normalizeTheme(t: Partial<PdfTheme> | null | undefined): PdfTheme {
  const x = { ...DEFAULT_THEME, ...(t ?? {}) };
  return {
    template: String(x.template || "guia").slice(0, 40),
    font: x.font === "merriweather" ? "merriweather" : "inter",
    primary: HEX.test(x.primary) ? x.primary : DEFAULT_THEME.primary,
    accent: HEX.test(x.accent) ? x.accent : DEFAULT_THEME.accent,
    pageSize: x.pageSize === "LETTER" ? "LETTER" : "A4",
    coverSubtitle: String(x.coverSubtitle ?? "").slice(0, 200),
    author: String(x.author ?? "").slice(0, 120),
    header: String(x.header ?? "").slice(0, 120),
    footer: String(x.footer ?? "").slice(0, 160),
    showToc: x.showToc !== false,
    pageNumbers: x.pageNumbers !== false,
  };
}

export function normalizeContent(c: unknown): PdfContent {
  const chapters = Array.isArray((c as PdfContent)?.chapters) ? (c as PdfContent).chapters : [];
  return {
    chapters: chapters
      .filter((x) => x && typeof x.title === "string")
      .map((x, i) => ({ id: String(x.id || `c${i + 1}`), title: x.title, summary: String(x.summary ?? ""), markdown: String(x.markdown ?? "") })),
  };
}
