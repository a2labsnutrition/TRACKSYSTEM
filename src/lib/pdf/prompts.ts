import { PAGE_BREAK } from "./blocks";
import { findTemplate } from "./templates";
import type { PdfChapter, PdfProject } from "./types";

/**
 * Tarefas e prompts do Estúdio de PDF (sem dependência de servidor: a tela
 * também monta o prompt de reescrita do trecho selecionado).
 */

export const PDF_SYSTEM = `Você é redator de infoprodutos no Brasil e escreve e-books, guias, workbooks e materiais de apoio para alunos.

Regras:
1. Português do Brasil, claro e prático, frases curtas, exemplos concretos.
2. Nunca invente dados: nada de estatísticas, estudos, depoimentos, nomes de alunos ou resultados que não estejam no briefing. Onde precisar de algo do autor, use um marcador entre colchetes, ex.: [FOTO DO PRATO], [HISTÓRIA PESSOAL DO AUTOR].
3. Saúde, estética, treino e finanças: sem promessas de resultado, sem alegações de cura; inclua aviso para procurar profissional quando couber.
4. Formato do conteúdo (markdown simples): "## " e "### " para subtítulos, parágrafos, listas "- " e "1. ", checklist "- [ ] ", tabelas com "|", destaques "> **Dica:** …" (também Atenção, Exercício, Resumo), citações "> …" e a linha ${PAGE_BREAK} para quebrar página. Não use "# " (o título do capítulo já existe).`;

function briefBlock(p: Pick<PdfProject, "title" | "brief" | "theme">) {
  const t = findTemplate(p.theme.template);
  return `Título provisório: ${p.title}\nTipo de material: ${t.name} (${t.description})\nBriefing do autor:\n${p.brief || "(sem briefing)"}`;
}

export function outlineTask(p: Pick<PdfProject, "title" | "brief" | "theme">) {
  const t = findTemplate(p.theme.template);
  return `Proponha o sumário deste material: título, subtítulo e capítulos (com resumo de cada um). Respeite o número de páginas/capítulos pedido no briefing; sem pedido, 5 a 8 capítulos. Estrutura de referência do modelo: ${t.outline.map((o) => o.title).join(" → ")}.\n\n${briefBlock(p)}`;
}

export function chapterTask(p: Pick<PdfProject, "title" | "brief" | "theme">, chapters: PdfChapter[], idx: number, extra: string | null) {
  const c = chapters[idx];
  return [
    `Escreva o capítulo ${idx + 1} — "${c.title}" — completo, pronto para o PDF.`,
    `O que ele cobre: ${c.summary || "(definir pelo título)"}`,
    extra ? `Pedido extra do autor: ${extra}` : "",
    `Sumário completo (para não repetir conteúdo de outros capítulos): ${chapters.map((x, i) => `${i + 1}. ${x.title}`).join("; ")}`,
    "",
    briefBlock(p),
  ]
    .filter(Boolean)
    .join("\n");
}

export function rewriteTask(excerpt: string, instruction: string, chapterTitle: string) {
  return `Reescreva o trecho abaixo do capítulo "${chapterTitle}" seguindo a instrução, mantendo o formato markdown e o sentido. Devolva só o trecho reescrito.\nInstrução: ${instruction}\n\nTrecho:\n${excerpt}`;
}

const manual = (task: string, format: string) => [PDF_SYSTEM, "", "## Tarefa", task, "", "## Formato da resposta", format].join("\n");

export function manualOutlinePrompt(p: Pick<PdfProject, "title" | "brief" | "theme">) {
  return manual(outlineTask(p), 'Só a lista de capítulos, um por linha, no formato "1. Título do capítulo — resumo em uma frase". Sem comentários.');
}
export function manualChapterPrompt(p: Pick<PdfProject, "title" | "brief" | "theme">, chapters: PdfChapter[], idx: number, extra: string | null) {
  return manual(chapterTask(p, chapters, idx, extra), "Só o conteúdo do capítulo em markdown simples (sem o título do capítulo, sem comentários antes ou depois).");
}
export function manualRewritePrompt(excerpt: string, instruction: string, chapterTitle: string) {
  return manual(rewriteTask(excerpt, instruction, chapterTitle), "Só o trecho reescrito, em markdown simples.");
}

/** Sumário colado da IA grátis: "1. Título — resumo" por linha. */
export function parseOutlineText(text: string): Array<{ title: string; summary: string }> {
  return text
    .split("\n")
    .map((l) => l.trim().replace(/^(?:#+\s*)?(?:cap[ií]tulo\s*)?\d+[.):-]?\s*/i, "").replace(/^[-*•]\s+/, "").replace(/\*\*/g, ""))
    .filter((l) => l.length > 2)
    .map((l) => {
      const [title, ...rest] = l.split(/\s+[—–-]\s+|:\s+/);
      return { title: title.trim().slice(0, 140), summary: rest.join(" — ").trim() };
    })
    .slice(0, 40);
}
