import { BUY_BUTTON } from "./markdown";
import type { LandingContent, OfferContent } from "./schemas";

/**
 * Prompt para o Lovable gerar a página de vendas já com o tracking.
 * Link "Build with URL" (documentação oficial do Lovable):
 *   https://lovable.dev/#prompt=<texto codificado>  — até 50.000 caracteres;
 * o Lovable abre com o prompt preenchido e o usuário clica em enviar.
 */

export const LOVABLE_MAX_PROMPT = 50_000;

export interface LovablePromptInput {
  /** Versão estruturada (IA) ou editada em markdown. */
  landing: LandingContent | string;
  offer?: OfferContent | null;
  productName: string;
  checkoutUrl: string | null;
  /** <script src=".../t.js" data-site="..." async></script> — ou null se não houver site cadastrado. */
  trackingSnippet: string | null;
}

const CHECKOUT_PLACEHOLDER = "[LINK DO CHECKOUT DA CAKTO]";

export function buildLovablePrompt(i: LovablePromptInput): string {
  const md = typeof i.landing === "string" ? i.landing : null;
  const l = typeof i.landing === "string" ? null : i.landing;
  const checkout = i.checkoutUrl?.trim() || CHECKOUT_PLACEHOLDER;
  const lines: string[] = [];
  lines.push(`Crie uma página de vendas (landing page de uma única página) em português do Brasil para o produto "${i.productName}".`);
  lines.push("");
  lines.push("## Regras técnicas (obrigatórias)");
  if (i.trackingSnippet) {
    lines.push(
      "1. Coloque EXATAMENTE este script no <head> do documento (renderizado no servidor, presente no HTML inicial de todas as páginas — se o projeto usa TanStack Start, adicione em `head()` do `__root.tsx` em `scripts`; não carregue via useEffect):",
    );
    lines.push("```html", i.trackingSnippet, "```");
  } else {
    lines.push("1. (Script de tracking: cadastre o site em Conexões na Central e cole o snippet no <head> depois.)");
  }
  lines.push(
    `2. TODOS os botões de compra devem ser links <a href="${checkout}" data-track="checkout">…</a> — nunca <button> com onClick nem window.location. Abra na mesma aba.`,
    "3. Não adicione código de Pixel do Meta, Google Tag Manager nem outro script de rastreamento: o script acima já cuida disso (e do consentimento de cookies/LGPD).",
    "4. Não invente depoimentos, números de alunos, faturamentos, prints ou selos. Onde o texto tiver marcadores entre colchetes (ex.: [DEPOIMENTO REAL DE ALUNO]), mantenha um bloco visível com o marcador para eu substituir depois.",
    "5. Mobile first (a maior parte do tráfego vem do celular), carregamento rápido, imagens com lazy loading, sem pop-ups de saída.",
    "6. Rodapé com nome do produto, links de Política de Privacidade e Termos de Uso e o aviso: \"Este site não faz parte do Facebook ou da Meta Platforms, Inc.\"",
  );
  if (l) {
    lines.push(
      "",
      "## Visual",
      `- Tipo de página: ${l.tipo_pagina}`,
      `- Cores: primária ${l.paleta.primaria}, fundo ${l.paleta.fundo}, texto ${l.paleta.texto}, destaque ${l.paleta.destaque}`,
      `- Tipografia: ${l.tipografia}`,
      `- Texto dos botões de compra: "${l.cta_texto}"`,
      "",
      "## Seções (nesta ordem, com o texto exatamente como abaixo)",
    );
    l.secoes.forEach((s, idx) => {
      lines.push("", `### ${idx + 1}. ${s.titulo}`, `Objetivo: ${s.objetivo}`, "", s.copy.trim());
      if (s.tem_botao_checkout) lines.push("", `[Botão de compra: <a href="${checkout}" data-track="checkout">${l.cta_texto}</a>]`);
    });
  } else if (md) {
    lines.push(
      "",
      "## Conteúdo (cada \"##\" é uma seção, nesta ordem, com o texto exatamente como abaixo)",
      `Onde aparecer ${BUY_BUTTON}, coloque um botão de compra: <a href="${checkout}" data-track="checkout">…</a>.`,
      "",
      md.trim(),
    );
  }
  const o = i.offer;
  if (o?.faq?.length && !(l ? l.secoes.map((s) => s.titulo).join(" ") : md ?? "").match(/faq|perguntas/i)) {
    lines.push("", "### Perguntas frequentes (acordeão)");
    for (const f of o.faq) lines.push(`- **${f.pergunta}** ${f.resposta}`);
  }
  if (!i.checkoutUrl) lines.push("", `Obs.: troque ${CHECKOUT_PLACEHOLDER} pelo link do checkout da Cakto.`);

  let prompt = lines.join("\n");
  if (prompt.length > LOVABLE_MAX_PROMPT) {
    const note = "\n\n[Prompt cortado no limite de 50.000 caracteres do Lovable — cole o restante da copy depois.]";
    prompt = prompt.slice(0, LOVABLE_MAX_PROMPT - note.length) + note;
  }
  return prompt;
}

/** Link que abre o Lovable com o prompt preenchido (o envio é manual). */
export function lovableUrl(prompt: string): string {
  return `https://lovable.dev/#prompt=${encodeURIComponent(prompt.slice(0, LOVABLE_MAX_PROMPT))}`;
}
