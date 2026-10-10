import type { PdfTheme } from "./types";

/** Modelos por tipo de entregável: briefing-base, estrutura sugerida e cores. */
export interface PdfTemplate {
  id: string;
  name: string;
  description: string;
  briefHint: string;
  outline: Array<{ title: string; summary: string }>;
  theme: Partial<PdfTheme>;
}

export const PDF_TEMPLATES: PdfTemplate[] = [
  {
    id: "guia",
    name: "Guia de iniciante",
    description: "Do zero ao primeiro resultado, passo a passo.",
    briefHint: "Guia para quem está começando em [tema]. Público: [quem]. Tom: simples e encorajador. Cerca de 30 páginas.",
    outline: [
      { title: "Antes de começar", summary: "O que é, para quem é e o que esperar (sem promessas)." },
      { title: "Os fundamentos", summary: "Os conceitos essenciais explicados com exemplos." },
      { title: "Passo a passo", summary: "O método em etapas numeradas." },
      { title: "Erros comuns", summary: "O que evitar e como corrigir." },
      { title: "Próximos passos", summary: "Plano de 7 dias e checklist final." },
    ],
    theme: { primary: "#1d4ed8", accent: "#f59e0b", font: "inter" },
  },
  {
    id: "receitas",
    name: "Livro de receitas",
    description: "Receitas com ingredientes, modo de preparo e dicas.",
    briefHint: "E-book de receitas de [tipo] para [público]. Cada receita com rendimento, tempo, ingredientes (lista), modo de preparo (passos numerados) e uma dica.",
    outline: [
      { title: "Como usar este livro", summary: "Utensílios, medidas e organização." },
      { title: "Receitas básicas", summary: "As bases que aparecem nas outras receitas." },
      { title: "Receitas do dia a dia", summary: "Receitas rápidas." },
      { title: "Receitas especiais", summary: "Para ocasiões e para vender, se for o caso." },
      { title: "Lista de compras", summary: "Checklist de ingredientes." },
    ],
    theme: { primary: "#b45309", accent: "#16a34a", font: "merriweather" },
  },
  {
    id: "treino",
    name: "Plano de treino",
    description: "Treinos com séries, repetições e progressão.",
    briefHint: "Plano de treino de [modalidade] para [nível], [X] semanas. Tabelas com exercício, séries, repetições e descanso. Aviso de procurar orientação profissional.",
    outline: [
      { title: "Antes de treinar", summary: "Aquecimento, segurança e aviso de orientação profissional." },
      { title: "Os exercícios", summary: "Como executar cada um." },
      { title: "Semanas 1 a 4", summary: "Tabelas de treino com progressão." },
      { title: "Acompanhamento", summary: "Checklist semanal e registro." },
    ],
    theme: { primary: "#dc2626", accent: "#0ea5e9", font: "inter" },
  },
  {
    id: "financas",
    name: "Planilha financeira impressa",
    description: "Orçamento, controle de gastos e metas para imprimir.",
    briefHint: "Material de organização financeira para [público]: explicação curta + tabelas para preencher (orçamento mensal, controle de gastos, metas, dívidas).",
    outline: [
      { title: "Como usar", summary: "Rotina de preenchimento." },
      { title: "Orçamento do mês", summary: "Tabela de entradas e saídas." },
      { title: "Controle de gastos", summary: "Tabela diária." },
      { title: "Metas e dívidas", summary: "Tabelas de acompanhamento." },
    ],
    theme: { primary: "#15803d", accent: "#1d4ed8", font: "inter" },
  },
  {
    id: "workbook",
    name: "Workbook com exercícios",
    description: "Conteúdo + exercícios e espaços para responder.",
    briefHint: "Workbook de [tema] com teoria curta e exercícios práticos no fim de cada capítulo (perguntas, checklists e tabelas para preencher).",
    outline: [
      { title: "Introdução", summary: "Como aproveitar o workbook." },
      { title: "Módulo 1", summary: "Conceito + exercícios." },
      { title: "Módulo 2", summary: "Conceito + exercícios." },
      { title: "Módulo 3", summary: "Conceito + exercícios." },
      { title: "Revisão final", summary: "Checklist e plano de ação." },
    ],
    theme: { primary: "#7c3aed", accent: "#f59e0b", font: "inter" },
  },
];

export function findTemplate(id: string | null | undefined): PdfTemplate {
  return PDF_TEMPLATES.find((t) => t.id === id) ?? PDF_TEMPLATES[0];
}
