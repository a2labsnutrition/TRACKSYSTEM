/** Textos dos tooltips: o que a métrica significa e o que fazer quando está ruim. */

export interface MetricDef {
  label: string;
  what: string;
  whenBad: string;
}

export const METRICS: Record<string, MetricDef> = {
  spend: {
    label: "Gasto",
    what: "Valor investido no Meta no período (fuso da conta de anúncios).",
    whenBad: "Gasto sem venda acima de 2× o CPA alvo é sinal de corte. Veja o pacing para não estourar o orçamento.",
  },
  netRevenue: {
    label: "Receita líquida",
    what: "Soma do valor líquido das vendas pagas confirmadas pela Cakto (já sem taxas do gateway).",
    whenBad: "Se está baixa com muitos checkouts, olhe a taxa de aprovação por método de pagamento.",
  },
  profit: {
    label: "Lucro",
    what: "Receita líquida − impostos configurados − gasto em anúncios.",
    whenBad: "Lucro negativo por 3+ dias com dados suficientes: otimize ou pause.",
  },
  roasReal: {
    label: "ROAS real",
    what: "Receita líquida da Cakto ÷ gasto. Diferente do ROAS do Meta, que usa o valor que o Pixel informa.",
    whenBad: "Abaixo do ROAS mínimo do produto = você perde dinheiro em cada venda.",
  },
  cpaReal: {
    label: "CPA real",
    what: "Gasto ÷ vendas pagas confirmadas na Cakto.",
    whenBad: "Acima do CPA máximo: revise criativo (CTR/hook) e página (connect rate/conversão).",
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
    what: "Vendas pagas confirmadas pela Cakto (real) ou atribuídas pelo Meta.",
    whenBad: "Menos de 3 compras no período = pouco dado para decidir.",
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
