import { fmtBRL } from "@/lib/format";
import type { ParecerContent } from "./schema";
import type { Snapshot } from "./snapshot";

/**
 * Parecer automático SEM IA, montado só com os sinais das regras e modelos de
 * ação. Usado quando não há ANTHROPIC_API_KEY ou a IA falha. É mais simples
 * que o parecer da IA e a interface deixa isso claro.
 */

type Gargalo = ParecerContent["gargalo"]["area"];

const brl = (v: number | null | undefined) => (v == null ? "—" : fmtBRL(v));

function detectBottleneck(s: Snapshot): Gargalo {
  const codes = new Set(s.veredito_regras.sinais.map((x) => x.codigo));
  if (codes.has("tracking_quebrado") || codes.has("dados_incompletos") || codes.has("vendas_sem_origem")) return "tracking";
  if (codes.has("connect_rate_baixo") || codes.has("pagina_nao_converte")) return "pagina";
  if (codes.has("ctr_baixo") || codes.has("hook_baixo") || codes.has("criativos_em_fadiga")) return "criativo";
  if (codes.has("frequencia_alta") || codes.has("saturacao_publico")) return "publico_saturacao";
  const leak = s.funil.vazamento_principal?.etapa ?? "";
  if (/Cliques/.test(leak)) return "criativo";
  if (/página|checkout/i.test(leak) && !/Pedido|Pago/.test(leak)) return "pagina";
  if (/Pedido|Pago/.test(leak)) return "checkout_pagamento";
  if (codes.has("cpa_acima_max") || codes.has("cpa_acima_alvo") || codes.has("roas_abaixo_min")) return "oferta_preco";
  return "nenhum";
}

const GARGALO_TXT: Record<Gargalo, string> = {
  tracking: "O tracking não está confiável: corrija as conexões antes de decidir orçamento.",
  pagina: "A perda está na página: cliques não viram visita ou visita não vira checkout.",
  criativo: "Os criativos não estão gerando clique/atenção suficiente ou estão cansados.",
  publico_saturacao: "O público está saturando: frequência e custo por mil subindo.",
  oferta_preco: "O funil passa, mas o custo por venda fica acima da meta: revise oferta, preço e ticket.",
  checkout_pagamento: "Muita gente chega ao checkout e não paga: atrito no pagamento ou Pix não pago.",
  nenhum: "Nenhum gargalo evidente nos dados atuais.",
};

export function fallbackParecer(s: Snapshot): ParecerContent {
  const v = s.veredito_regras;
  const sinais = v.sinais.filter((x) => x.severidade !== "info");
  const g = detectBottleneck(s);
  const w7 = s.janelas.ultimos_7_dias;
  const recs = v.recomendacoes;

  // Plano = recomendações do motor (já com tamanho de passo calculado, sem regra fixa)
  const plano: ParecerContent["plano"] = recs.slice(0, 6).map((r, i) => ({
    quando: i === 0 ? "Agora" : "Em seguida",
    acao: r.titulo,
    condicao: r.reavaliar ? `Reavaliar: ${r.reavaliar}` : null,
  }));
  if (!plano.length) plano.push({ quando: "Próximos 3 dias", acao: "Manter orçamento e criativos; acompanhar CPA e frequência.", condicao: null });

  const diag = sinais.slice(0, 3).map((x) => x.mensagem);
  const fills = [
    `Últimos 7 dias: gasto ${brl(w7.gasto_rs)}, ${w7.compras_principais_com_origem} compra(s) principal(is) com origem identificada, CPA ${brl(w7.cpa_rs)}.`,
    `Faturamento bruto no período ${brl(s.financeiro_periodo.faturamento_bruto_aprovado_rs)}; lucro de contribuição estimado ${brl(s.financeiro_periodo.lucro_de_contribuicao_estimado_rs)}.`,
    v.resumo,
  ];
  for (const f of fills) if (diag.length < 3) diag.push(f);

  const criativos = s.criativos.anuncios;
  const fortes = criativos.filter((a) => a.classificacao === "destaque_comprovado" || a.classificacao === "sinal_positivo");
  const cansados = criativos.filter((a) => a.fadiga);

  const naoSabemos: string[] = [];
  if (s.atribuicao_periodo.vendas_sem_origem_no_workspace > 0)
    naoSabemos.push(`${s.atribuicao_periodo.vendas_sem_origem_no_workspace} venda(s) sem origem identificada — podem ser desta ou de outra campanha.`);
  if (s.cambio) naoSabemos.push("Gasto convertido de outra moeda com câmbio estimado (cotação + IOF/spread).");
  for (const c of v.criterios_confianca) if (c.nivel === "baixa") naoSabemos.push(`${c.criterio}: ${c.valor}.`);
  if (v.dados_faltando) naoSabemos.push(v.dados_faltando);

  return {
    veredito: { status: v.status, confianca: v.confianca, justificativa: v.resumo, concorda_com_regras: true },
    diagnostico: diag,
    gargalo: { area: g, explicacao: GARGALO_TXT[g] },
    plano,
    testes: s.criativos.testes_sugeridos.slice(0, 3).map((t) => ({
      hipotese: t.title,
      o_que_mudar: t.detail,
      metrica_sucesso: `CPA abaixo de ${brl(s.metas.cpa_maximo_rs)} com volume para comparar`,
      orcamento: `~${brl((s.metas.cpa_maximo_rs ?? 0) * 3)} por variante`,
      prazo: "até cada variante atingir o orçamento",
    })),
    riscos: [...new Set(recs.flatMap((r) => r.riscos))].slice(0, 5),
    nao_mexer: s.campanha.conjuntos_em_aprendizado.length
      ? [`Não editar público/criativo dos conjuntos em aprendizado: ${s.campanha.conjuntos_em_aprendizado.join(", ")}.`]
      : ["Não mudar várias coisas ao mesmo tempo: fica impossível saber o que funcionou."],
    caminhos: [
      { nome: "Escala vertical gradual", descricao: "Aumentar o orçamento em passos proporcionais à folga do CPA, só com lucro comprovado.", pros: ["Simples", "Mantém o que funciona"], contras: ["CPA marginal tende a subir", "Pode reiniciar o aprendizado"] },
      { nome: "Escala horizontal", descricao: "Duplicar o conjunto que vende em públicos novos.", pros: ["Alcança gente nova", "Menos risco para o original"], contras: ["Divide o orçamento", "Novo aprendizado"] },
      { nome: "Novo ângulo de criativo", descricao: "Testar uma promessa/dor diferente com orçamento igual por variante.", pros: ["Combate fadiga", "Pode baixar o CPA"], contras: ["Leva dias para ter dados", "Custo de produção"] },
    ],
    proximos_criativos: [
      ...fortes.slice(0, 2).map((a) => ({ angulo: "Variações do que mostrou sinal", gancho: a.texto_inicio ?? a.nome, motivo: a.motivos[0] ?? "" })),
      ...(cansados.length ? [{ angulo: "Substituir criativos cansados", gancho: "Mesma promessa, nova abertura nos 3 primeiros segundos", motivo: `${cansados.length} anúncio(s) em fadiga.` }] : []),
      { angulo: "Prova social", gancho: "Depoimento curto de aluno com resultado (sem antes/depois)", motivo: "Ângulo diferente para testar contra o atual." },
    ],
    alerta_tracking: g === "tracking" ? "Tracking com problemas: os números de venda podem estar incompletos." : null,
    o_que_nao_sabemos: naoSabemos,
    o_que_mudaria_a_decisao: [...new Set(recs.flatMap((r) => r.invalida_se))].slice(0, 5),
  };
}
