import { fmtBRL } from "@/lib/format";
import type { ComplianceFlag } from "./compliance";
import type { AngleScripts, ComplianceRewrites, LandingContent, OfferContent, PlanContent, ScriptsContent, VslContent } from "./schemas";
import type { CampaignStructure } from "./structure";
import type { KitSection, KitSectionKind } from "./types";

/**
 * Converte cada seção do kit em markdown simples — para exibir, copiar e editar.
 * Uma edição salva vira uma nova versão no formato "markdown".
 */

export const BUY_BUTTON = "[BOTÃO DE COMPRA]";

export interface ComplianceData {
  flags: ComplianceFlag[];
  rewrites: ComplianceRewrites | null;
  scanned: string[];
  scannedAt: string;
}

const list = (items: string[] | undefined) => (items ?? []).filter(Boolean).map((i) => `- ${i}`).join("\n");

function plan(p: PlanContent): string {
  return [
    "## Público",
    p.publico.quem,
    "",
    "**Dores**",
    list(p.publico.dores),
    "",
    "**Desejos**",
    list(p.publico.desejos),
    "",
    "**Objeções**",
    list(p.publico.objecoes),
    "",
    "## Ângulos",
    ...p.angulos.map((a, i) => `### ${i + 1}. ${a.nome}\n${a.ideia}\n\n- Gancho de exemplo: "${a.gancho_exemplo}"\n- Por quê: ${a.por_que}\n`),
    "## Produto",
    `**Recomendado:** ${p.tipo_produto.recomendado}`,
    p.tipo_produto.alternativas.length ? `**Alternativas:** ${p.tipo_produto.alternativas.join("; ")}` : "",
    p.tipo_produto.por_que,
    "",
    "## Preço",
    `**Faixa:** ${p.preco.faixa}`,
    `**Ancoragem:** ${p.preco.ancoragem}`,
    p.preco.por_que,
    "",
    "## Estrutura da oferta",
    `- Promessa: ${p.estrutura_oferta.promessa}`,
    `- Mecanismo único: ${p.estrutura_oferta.mecanismo_unico}`,
    `- Bônus: ${p.estrutura_oferta.bonus.join("; ")}`,
    `- Garantia: ${p.estrutura_oferta.garantia}`,
    `- Order bump: ${p.estrutura_oferta.orderbump}`,
    `- Upsell: ${p.estrutura_oferta.upsell}`,
    "",
    "## Estratégia de página",
    `**${p.estrategia_pagina.formato}** — ${p.estrategia_pagina.por_que}`,
    "",
    "## Estratégia de criativo",
    `**${p.estrategia_criativo.formatos.join(", ")}** — ${p.estrategia_criativo.por_que}`,
    "",
    "## Riscos",
    list(p.riscos),
    "",
    "## O que ainda não sabemos (validar com dados)",
    list(p.o_que_nao_sabemos),
  ].join("\n");
}

function offer(o: OfferContent): string {
  return [
    `## ${o.nome}`,
    `**Promessa:** ${o.promessa_principal}`,
    "",
    `**Mecanismo:** ${o.mecanismo}`,
    "",
    "## Estrutura do produto",
    ...o.estrutura_produto.map((m) => `- **${m.modulo}:** ${m.entrega}`),
    "",
    "## Bônus",
    ...o.bonus.map((b) => `- **${b.nome}:** ${b.descricao} _(${b.por_que})_`),
    "",
    "## Garantia",
    o.garantia,
    "",
    "## Preço",
    `- Valor: ${o.preco.valor}`,
    `- Ancoragem: ${o.preco.ancoragem}`,
    `- Parcelamento: ${o.preco.parcelamento}`,
    "",
    "## Order bump",
    `**${o.orderbump.nome}** (${o.orderbump.preco}) — ${o.orderbump.por_que}`,
    "",
    "## Upsell",
    `**${o.upsell.nome}** (${o.upsell.preco}) — ${o.upsell.por_que}`,
    "",
    "## Perguntas frequentes",
    ...o.faq.map((f) => `**${f.pergunta}**\n${f.resposta}\n`),
  ].join("\n");
}

export function landingMarkdown(l: LandingContent): string {
  return [
    `_Tipo: ${l.tipo_pagina} · Cores: ${l.paleta.primaria} / ${l.paleta.fundo} / ${l.paleta.texto} / ${l.paleta.destaque} · Fonte: ${l.tipografia} · Botão: "${l.cta_texto}"_`,
    "",
    ...l.secoes.map((s) => `## ${s.titulo}\n_Objetivo: ${s.objetivo}_\n\n${s.copy.trim()}${s.tem_botao_checkout ? `\n\n${BUY_BUTTON}` : ""}\n`),
    "## Provas reais a coletar",
    list(l.provas_a_coletar),
  ].join("\n");
}

function vsl(v: VslContent): string {
  const block = (b: VslContent["longa"][number]) => `**${b.tempo} · ${b.bloco}**\n${b.fala}\n\n_Tela: ${b.broll}_\n`;
  return ["## VSL longa", ...v.longa.map(block), "## VSL curta (60–90s)", ...v.curta.map(block), "## Observações", list(v.observacoes)].join("\n");
}

function angle(a: AngleScripts): string {
  return [
    `## Ângulo: ${a.angulo}`,
    "### Ganchos",
    a.ganchos.map((g, i) => `${i + 1}. ${g}`).join("\n"),
    "",
    ...a.roteiros.map(
      (r) =>
        `### ${r.duracao_s}s · ${r.formato}\n${r.roteiro}\n\n- **Texto principal:** ${r.texto_principal}\n- **Título:** ${r.titulo}\n- **Descrição:** ${r.descricao}\n- **Hipótese de teste:** ${r.hipotese}\n`,
    ),
    "### Prompts para o Google Flow",
    ...a.prompts_video.map((p) => `- **${p.cena}** (${p.proporcao}, ${p.duracao_s}s): ${p.prompt}`),
    "",
  ].join("\n");
}

function scripts(s: ScriptsContent): string {
  return s.angulos.map(angle).join("\n");
}

export function structureMarkdown(s: CampaignStructure): string {
  return [
    "## Campanha",
    `- **Objetivo:** ${s.objetivo}`,
    `- **Evento de otimização:** ${s.evento}`,
    `- **CPA máximo:** ${s.cpaMaximo != null ? fmtBRL(s.cpaMaximo) : "sem dados"}${s.cpaMaximoOrigem === "estimado_pelo_preco" ? " (estimado pelo preço)" : ""}`,
    `- **Nome:** \`${s.nomenclatura.campanha}\``,
    "",
    "## Teste de criativos",
    s.teste.tipo,
    "",
    ...s.teste.conjuntos.map((c) => `**Conjunto \`${c.nome}\`** — ${c.publico}\n${c.anuncios.map((a) => `- \`${a}\``).join("\n")}\n`),
    `- **Orçamento por criativo:** ${fmtBRL(s.teste.orcamentoPorCriativo)}`,
    `- **Total do teste:** ${fmtBRL(s.teste.totalTeste)}`,
    s.teste.orcamentoDiario ? `- **Com ${fmtBRL(s.teste.orcamentoDiario)}/dia:** ~${s.teste.diasEstimados} dia(s)` : "- Informe o orçamento diário para estimar a duração.",
    "",
    s.teste.explicacao,
    "",
    "## Públicos",
    ...s.publicos.map((p) => `- **${p.nome}:** ${p.quando}`),
    "",
    "## Quando cortar",
    list(s.regrasCorte),
    "",
    "## Quando escalar",
    list(s.regrasEscala),
    "",
    "## Nomenclatura",
    `- Campanha: \`${s.nomenclatura.campanha}\``,
    `- Conjunto: \`${s.nomenclatura.conjunto}\``,
    `- Anúncio: \`${s.nomenclatura.anuncio}\``,
    "",
    "## Parâmetros de URL (UTMs)",
    `\`${s.utms}\``,
    "",
    "## Checklist de lançamento",
    list(s.checklist),
    ...(s.avisos.length ? ["", "## Avisos", list(s.avisos)] : []),
  ].join("\n");
}

function compliance(c: ComplianceData): string {
  const out = [`Seções verificadas: ${c.scanned.join(", ") || "nenhuma"}.`, ""];
  if (!c.flags.length) out.push("Nenhum trecho arriscado encontrado pelo verificador automático. Ainda assim, revise antes de publicar.");
  else {
    out.push(`## ${c.flags.length} trecho(s) sinalizado(s)`);
    for (const f of c.flags) out.push(`- **${f.label}** (${f.severity === "alto" ? "risco alto" : "atenção"} · ${f.section}): "${f.excerpt}" — ${f.reason}`);
  }
  if (c.rewrites?.itens.length) {
    out.push("", "## Reescritas sugeridas (IA)");
    for (const r of c.rewrites.itens) out.push(`- **Trecho:** "${r.trecho}"\n  - Problema: ${r.problema}\n  - Sugestão: ${r.reescrita}`);
    if (c.rewrites.observacoes.length) out.push("", list(c.rewrites.observacoes));
  }
  out.push("", "_Verificador automático: sinaliza padrões de risco (políticas do Meta, CONAR, ANVISA). Não substitui a revisão humana._");
  return out.join("\n");
}

export function sectionToMarkdown(kind: KitSectionKind, section: Pick<KitSection, "format" | "data">): string {
  if (section.format === "markdown") return typeof section.data === "string" ? section.data : "";
  const d = section.data as never;
  try {
    switch (kind) {
      case "plan":
        return plan(d);
      case "offer":
        return offer(d);
      case "landing":
        return landingMarkdown(d);
      case "vsl":
        return vsl(d);
      case "scripts":
        return scripts(d);
      case "structure":
        return structureMarkdown(d);
      case "compliance":
        return compliance(d);
    }
  } catch {
    return "```\n" + JSON.stringify(section.data, null, 2) + "\n```";
  }
}
