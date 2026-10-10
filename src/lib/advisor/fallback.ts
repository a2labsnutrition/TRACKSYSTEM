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
  if (codes.has("tracking_quebrado")) return "tracking";
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
  const b = s.sugestoes_orcamento_rs;
  const w7 = s.janelas.ultimos_7_dias;
  const alvo = s.metas.cpa_alvo_rs;
  const plano: ParecerContent["plano"] = [];

  if (g === "tracking") plano.push({ quando: "Hoje", acao: "Corrigir as conexões marcadas em Saúde do tracking (script, webhook da Cakto, CAPI).", condicao: null });

  switch (v.status) {
    case "escalar":
      if (b) plano.push({ quando: "Hoje", acao: `Aumentar o orçamento 20%: ${brl(b.atual)} → ${brl(b.mais_20pct)}.`, condicao: `se o CPA real de 3 dias seguir ≤ ${brl(alvo)}` });
      if (b) plano.push({ quando: "Dia 3", acao: `Novo aumento de 20% (≈ ${brl((b.mais_20pct ?? 0) * 1.2)}).`, condicao: `se o CPA real de 3 dias seguir ≤ ${brl(alvo)}` });
      plano.push({ quando: "Dias 3-5", acao: "Duplicar o conjunto vencedor em um público novo (escala horizontal) com o mesmo criativo.", condicao: null });
      plano.push({ quando: "Dia 7", acao: "Revisar: se o CPA subir acima da meta por 2 dias, voltar ao último orçamento estável.", condicao: null });
      break;
    case "pausar":
      plano.push({ quando: "Hoje", acao: "Pausar a campanha (ou os conjuntos sem venda) para parar a perda.", condicao: null });
      plano.push({ quando: "Dias 2-3", acao: `Reaproveitar a verba (${brl(w7.gasto_rs)} na última semana) nas campanhas com CPA dentro da meta.`, condicao: null });
      plano.push({ quando: "Dias 3-7", acao: `Relançar só com um ângulo novo de criativo ou página corrigida, com teste de até ${brl((alvo ?? 0) * 2)}.`, condicao: null });
      break;
    case "aguardar":
      plano.push({ quando: "Próximos dias", acao: `Manter o orçamento sem mexer. ${v.dados_faltando ?? ""}`.trim(), condicao: null });
      plano.push({ quando: "Ao atingir o volume", acao: "Gerar novo parecer para decidir escalar, otimizar ou pausar.", condicao: null });
      break;
    case "otimizar":
      if (g === "criativo") plano.push({ quando: "Dias 1-2", acao: "Subir 3 criativos novos com ganchos diferentes no conjunto principal.", condicao: null });
      if (g === "pagina") plano.push({ quando: "Hoje", acao: "Testar a velocidade da página no celular e conferir se o link do anúncio abre sem redirecionar.", condicao: null });
      if (g === "publico_saturacao") plano.push({ quando: "Dias 1-2", acao: "Ampliar o público (amplo/Advantage+) e excluir compradores dos últimos 180 dias.", condicao: null });
      if (g === "checkout_pagamento") plano.push({ quando: "Hoje", acao: "Ativar recuperação de Pix/boleto (WhatsApp/e-mail) e revisar parcelamento no checkout.", condicao: null });
      if (g === "oferta_preco") plano.push({ quando: "Dias 2-4", acao: "Testar um bônus ou orderbump para subir o valor por venda.", condicao: null });
      if (b) plano.push({ quando: "Enquanto otimiza", acao: `Manter o orçamento em ${brl(b.atual)} (sem aumentar).`, condicao: null });
      plano.push({ quando: "Dia 4", acao: "Pausar os anúncios com gasto acima de 2× o CPA alvo e sem venda.", condicao: null });
      break;
    default:
      plano.push({ quando: "Próximos 3 dias", acao: "Manter orçamento e criativos; acompanhar CPA e frequência diariamente.", condicao: null });
      plano.push({ quando: "Dia 3", acao: "Anotar qualquer mudança feita para comparar no próximo parecer.", condicao: null });
  }

  const diag = sinais.slice(0, 3).map((x) => x.mensagem);
  while (diag.length < 3) {
    const fill = [
      `Últimos 7 dias: gasto ${brl(w7.gasto_rs)}, ${w7.vendas_pagas_cakto} venda(s) paga(s), CPA real ${brl(w7.cpa_real_rs)}.`,
      `CTR do link ${w7.ctr_link_pct ?? "—"}% e ROAS real ${w7.roas_real ?? "—"}.`,
      v.resumo,
    ][diag.length];
    diag.push(fill);
  }

  const winner = [...s.anuncios].filter((a) => a.vendas > 0 && a.cpa_real_rs != null).sort((a, b2) => (a.cpa_real_rs ?? 0) - (b2.cpa_real_rs ?? 0))[0];
  const tired = s.anuncios.filter((a) => a.fadiga);

  return {
    veredito: { status: v.status, confianca: v.confianca, justificativa: v.resumo, concorda_com_regras: true },
    diagnostico: diag,
    gargalo: { area: g, explicacao: GARGALO_TXT[g] },
    plano,
    testes: [
      {
        hipotese:
          g === "pagina"
            ? "Uma página mais rápida/headline mais clara aumenta a taxa de checkout."
            : g === "criativo"
              ? "Ganchos novos nos 3 primeiros segundos aumentam CTR e reduzem CPA."
              : "Um bônus aumenta a conversão sem subir o CPA.",
        o_que_mudar: g === "pagina" ? "Headline e primeira dobra da página" : g === "criativo" ? "3 ganchos novos no mesmo roteiro" : "Oferta com bônus",
        metrica_sucesso: g === "pagina" ? "Taxa de checkout +20%" : `CPA real ≤ ${brl(alvo)}`,
        orcamento: brl((alvo ?? 50) * 3),
        prazo: "3 a 4 dias",
      },
    ],
    riscos: [
      "Mudanças grandes de orçamento (> 20% de uma vez) reiniciam o aprendizado.",
      ...(s.tracking.integracoes.some((i) => i.status === "error" || i.status === "missing") ? ["Com tracking incompleto, CPA e ROAS podem estar distorcidos."] : []),
    ],
    nao_mexer: s.campanha.conjuntos_em_aprendizado.length
      ? [`Não editar público/criativo dos conjuntos em aprendizado: ${s.campanha.conjuntos_em_aprendizado.join(", ")}.`]
      : ["Não mexer nos anúncios que estão vendendo dentro da meta."],
    caminhos: [
      { nome: "Escala vertical", descricao: "Subir o orçamento da campanha que já vende em passos de 20%.", pros: ["Simples", "Mantém o que funciona"], contras: ["Pode subir o CPA", "Risco de reiniciar aprendizado"] },
      { nome: "Escala horizontal", descricao: "Duplicar o conjunto vencedor em públicos novos (amplo, lookalike, interesses).", pros: ["Alcança gente nova", "Menos risco para o original"], contras: ["Divide o orçamento", "Precisa de novo aprendizado"] },
      { nome: "Novo ângulo de criativo", descricao: "Testar uma promessa/dor diferente com 3 criativos.", pros: ["Combate fadiga", "Pode baixar CPA"], contras: ["Leva dias para ter dados", "Custo de produção"] },
    ],
    proximos_criativos: [
      ...(winner ? [{ angulo: "Repetir o vencedor", gancho: winner.texto_inicio ?? winner.nome, motivo: `Melhor CPA real (${brl(winner.cpa_real_rs)}) entre os anúncios.` }] : []),
      ...(tired.length ? [{ angulo: "Substituir criativos cansados", gancho: "Mesma promessa, novo gancho visual nos 3 primeiros segundos", motivo: `${tired.length} anúncio(s) em fadiga.` }] : []),
      { angulo: "Prova social", gancho: "Depoimento curto de aluno com resultado (sem antes/depois)", motivo: "Ângulo diferente para testar contra o atual." },
    ],
    alerta_tracking: g === "tracking" ? "Tracking com problemas: os números de venda podem estar incompletos." : null,
  };
}
