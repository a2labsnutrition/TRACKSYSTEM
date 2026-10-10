/** Textos dos tooltips: o que a métrica significa e o que fazer quando está ruim. */

export interface MetricDef {
  label: string;
  what: string;
  whenBad: string;
}

export const METRICS: Record<string, MetricDef> = {
  spend: {
    label: "Gasto",
    what: "Valor investido no Meta no período (fuso da conta de anúncios). Conta em outra moeda: convertido para R$ com cotação + IOF/spread e marcado como estimado.",
    whenBad: "Gasto sem venda só vira sinal forte quando zero vendas seria improvável no CPA máximo (≈ 3× o CPA máximo sem venda). Veja o pacing para não estourar o orçamento.",
  },
  grossRevenue: {
    label: "Faturamento bruto",
    what: "Valor dos pedidos aprovados na Cakto no período (produto principal + order bumps + upsells), antes de taxas, impostos e reembolsos.",
    whenBad: "Faturamento não é lucro: veja o lucro de contribuição.",
  },
  netRevenue: {
    label: "Receita após taxas",
    what: "Faturamento após reembolsos menos as taxas da Cakto (estimadas quando o webhook não informa o líquido).",
    whenBad: "Se está baixa com muitos checkouts, olhe a taxa de aprovação por método de pagamento.",
  },
  profit: {
    label: "Lucro de contribuição (estimado)",
    what: "Faturamento após reembolsos − taxas − impostos − custos variáveis do produto − anúncios. NÃO é lucro líquido: não inclui custos fixos (equipe, ferramentas, pró-labore).",
    whenBad: "Negativo com dados suficientes (intervalo do CPA acima do equilíbrio): otimize ou reduza.",
  },
  grossMinusAds: {
    label: "Faturamento − tráfego",
    what: "Faturamento bruto menos o gasto com anúncios. Conta rápida — não desconta taxas, impostos, reembolsos nem custos.",
    whenBad: "Nunca use como lucro.",
  },
  roasReal: {
    label: "ROAS bruto",
    what: "Faturamento bruto aprovado (Cakto) ÷ gasto. Diferente do ROAS do Meta, que usa o valor que o Pixel informa e a janela de atribuição do Meta.",
    whenBad: "Abaixo do ROAS de equilíbrio (bruto ÷ contribuição antes de anúncios) cada venda dá prejuízo.",
  },
  cpaReal: {
    label: "CPA",
    what: "Gasto ÷ compras do PRODUTO PRINCIPAL pagas na Cakto. Order bumps e upsells não contam como compra.",
    whenBad: "Acima do CPA de equilíbrio (contribuição por venda antes de anúncios) cada venda dá prejuízo. Com poucas vendas, olhe o intervalo de 95%.",
  },
  roasMeta: {
    label: "ROAS (Meta)",
    what: "Valor de conversão informado pelo Meta ÷ gasto. Depende do Pixel/CAPI e da janela de atribuição.",
    whenBad: "Se diverge muito do ROAS real, verifique o painel de saúde do tracking.",
  },
  cpaMeta: {
    label: "CPA (Meta)",
    what: "Gasto ÷ compras atribuídas pelo Meta.",
    whenBad: "Compare com o CPA real; diferença grande indica tracking quebrado ou janela de atribuição.",
  },
  purchases: {
    label: "Compras",
    what: "Compras do produto principal pagas na Cakto. O número do Meta (Pixel/CAPI, com a janela de atribuição dele) aparece separado e nunca é somado.",
    whenBad: "Com poucas compras o CPA tem intervalo largo: o sistema diz quanto falta para concluir.",
  },
  cpm: {
    label: "CPM",
    what: "Custo por mil impressões.",
    whenBad: "CPM subindo com frequência alta = saturação de público. Teste públicos mais amplos ou novos criativos.",
  },
  ctrLink: {
    label: "CTR (link)",
    what: "Cliques no link ÷ impressões.",
    whenBad: "Abaixo de ~1% costuma indicar criativo/gancho fraco para o público.",
  },
  ctrAll: {
    label: "CTR (todos)",
    what: "Todos os cliques (inclui curtidas, expandir texto, perfil) ÷ impressões.",
    whenBad: "CTR todos alto e CTR link baixo: o anúncio chama atenção mas não leva para a página.",
  },
  cpcLink: {
    label: "CPC (link)",
    what: "Gasto ÷ cliques no link.",
    whenBad: "CPC alto com CTR bom = CPM caro (leilão/público). CPC alto com CTR ruim = criativo.",
  },
  frequency: {
    label: "Frequência",
    what: "Média de vezes que cada pessoa viu o anúncio (aproximação: impressões ÷ soma do alcance diário).",
    whenBad: "Acima de 2,5 em público frio costuma gerar fadiga. Renove criativos ou amplie o público.",
  },
  connectRate: {
    label: "Connect rate",
    what: "Visualizações da página de destino ÷ cliques no link. Mede quantos cliques realmente chegam a carregar a página.",
    whenBad: "Abaixo de 75%: página lenta, fora do ar ou redirecionamentos. Teste a velocidade no celular.",
  },
  checkoutRate: {
    label: "Taxa de checkout",
    what: "Inícios de checkout ÷ visualizações da página.",
    whenBad: "Baixa = página não convence (headline, prova, oferta, preço) ou botão mal posicionado.",
  },
  purchaseRate: {
    label: "Taxa de compra",
    what: "Compras ÷ inícios de checkout.",
    whenBad: "Baixa = atrito no checkout, preço/parcelamento, ou Pix gerado e não pago.",
  },
  hookRate: {
    label: "Hook rate",
    what: "Reproduções de 3s ÷ impressões. Mede se os primeiros segundos param a rolagem.",
    whenBad: "Abaixo de ~25%: troque os 3 primeiros segundos (gancho visual + frase).",
  },
  holdRate: {
    label: "Hold rate",
    what: "ThruPlay ÷ reproduções de 3s. Mede se o vídeo segura a atenção depois do gancho.",
    whenBad: "Baixo: o meio do vídeo está lento. Corte, acelere, antecipe a promessa.",
  },
  approvalRate: {
    label: "Taxa de aprovação",
    what: "Pedidos pagos ÷ pedidos gerados, por método (Pix, cartão, boleto).",
    whenBad: "Pix com aprovação baixa: use recuperação (WhatsApp/e-mail). Cartão baixo: verifique antifraude.",
  },
  divergence: {
    label: "Divergência Meta × real",
    what: "Diferença entre compras que o Meta atribui e compras confirmadas na Cakto atribuídas a anúncios.",
    whenBad: "Acima de 15%: revise a instalação do script, CAPI e parâmetros no checkout.",
  },
  pacing: {
    label: "Pacing",
    what: "Gasto de hoje vs. orçamento diário, com projeção de fechamento do dia.",
    whenBad: "Projeção muito acima do orçamento = gasto acelerado; muito abaixo = problema de entrega.",
  },
};
