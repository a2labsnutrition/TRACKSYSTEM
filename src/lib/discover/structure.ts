import { fmtBRL } from "@/lib/format";

/**
 * Estrutura da campanha (determinística). As regras de corte e de escala são as
 * MESMAS do motor de decisão do Tracking — o kit não usa números mágicos:
 *  - orçamento de teste por criativo = 3 × CPA máximo (se o CPA real fosse o
 *    máximo, a chance de zero vendas com esse gasto seria ~5%);
 *  - escala só com lucro comprovado (intervalo de 95% do CPA abaixo do máximo),
 *    3+ dias e confiança moderada/alta, em passos proporcionais à folga.
 */

export interface StructureInput {
  productName: string;
  price: number | null;
  /** CPA máximo informado; se vazio, estimado pelo preço. */
  maxCpa: number | null;
  feeRate: number;
  taxRate: number;
  dailyBudget: number | null;
  angles: string[];
  /** YYYY-MM-DD */
  date: string;
}

export interface CampaignStructure {
  objetivo: string;
  evento: string;
  cpaMaximo: number | null;
  cpaMaximoOrigem: "informado" | "estimado_pelo_preco" | "sem_dados";
  teste: {
    tipo: string;
    conjuntos: Array<{ nome: string; publico: string; anuncios: string[] }>;
    orcamentoPorCriativo: number | null;
    totalTeste: number | null;
    orcamentoDiario: number | null;
    diasEstimados: number | null;
    explicacao: string;
  };
  publicos: Array<{ nome: string; quando: string }>;
  regrasCorte: string[];
  regrasEscala: string[];
  nomenclatura: { campanha: string; conjunto: string; anuncio: string; exemplos: string[] };
  utms: string;
  checklist: string[];
  avisos: string[];
}

export function slugPart(v: string): string {
  return (
    v
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^A-Za-z0-9]+/g, " ")
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .map((w, i) => (i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
      .join("") || "x"
  );
}

export const UTM_TEMPLATE =
  "utm_source=facebook&utm_medium=paid&utm_campaign={{campaign.name}}|{{campaign.id}}&utm_term={{adset.name}}|{{adset.id}}&utm_content={{ad.name}}|{{ad.id}}";

const r2 = (v: number) => Math.round(v * 100) / 100;

export function buildCampaignStructure(i: StructureInput): CampaignStructure {
  const avisos: string[] = [];
  let maxCpa = i.maxCpa && i.maxCpa > 0 ? i.maxCpa : null;
  let origem: CampaignStructure["cpaMaximoOrigem"] = maxCpa ? "informado" : "sem_dados";
  if (!maxCpa && i.price && i.price > 0) {
    maxCpa = r2(i.price * (1 - i.feeRate - i.taxRate));
    origem = "estimado_pelo_preco";
    avisos.push(`CPA máximo estimado em ${fmtBRL(maxCpa)} (preço − taxa da Cakto − impostos, sem custos variáveis). Cadastre o produto com os custos para o valor exato.`);
  }
  if (!maxCpa) avisos.push("Informe o preço do produto para calcular orçamento de teste e regras.");

  const prod = slugPart(i.productName || "produto");
  const ddmm = `${i.date.slice(8, 10)}${i.date.slice(5, 7)}`;
  const angles = (i.angles.length ? i.angles : ["angulo1", "angulo2", "angulo3"]).slice(0, 5);
  const conjuntos = angles.slice(0, 3).map((a, idx) => ({
    nome: `[${prod}]_${slugPart(a)}_amplo`,
    publico: "Amplo (Brasil, 18–65, sem interesses) — deixe o algoritmo achar o comprador",
    anuncios: [1, 2, 3].map((n) => `[${prod}]_${slugPart(a)}_amplo_c${String(idx * 3 + n).padStart(2, "0")}_${ddmm}`),
  }));
  const nCreatives = conjuntos.reduce((s, c) => s + c.anuncios.length, 0);
  const perCreative = maxCpa ? r2(3 * maxCpa) : null;
  const total = perCreative ? r2(perCreative * nCreatives) : null;
  const daily = i.dailyBudget && i.dailyBudget > 0 ? i.dailyBudget : null;

  return {
    objetivo: "Vendas (conversões no site)",
    evento:
      "Compra (Purchase) — enviada pela API de Conversões a partir da venda aprovada na Cakto. Referência do Meta: o conjunto sai do aprendizado com cerca de 50 eventos de otimização por semana; com poucas vendas, concentre em poucos conjuntos.",
    cpaMaximo: maxCpa,
    cpaMaximoOrigem: origem,
    teste: {
      tipo: "ABO (orçamento por conjunto) para testar criativos com verba igual — evita que o algoritmo concentre tudo em um anúncio antes de haver dados",
      conjuntos,
      orcamentoPorCriativo: perCreative,
      totalTeste: total,
      orcamentoDiario: daily,
      diasEstimados: total && daily ? Math.ceil(total / daily) : null,
      explicacao: perCreative
        ? `Cada criativo precisa gastar ~${fmtBRL(perCreative)} (3× o CPA máximo de ${fmtBRL(maxCpa)}) antes de ser julgado: se o CPA real fosse o máximo, a chance de zero vendas com esse gasto seria de ~5%. Antes disso, zero venda é compatível com azar.`
        : "Sem CPA máximo não dá para calcular o orçamento de teste.",
    },
    publicos: [
      { nome: "Amplo", quando: "Padrão para começar: o Pixel/CAPI com bons eventos encontra o comprador." },
      { nome: "Interesses", quando: "Como comparação, 1 conjunto com 3–5 interesses do nicho." },
      { nome: "Lookalike de compradores", quando: "Quando houver uma lista de compradores (o Meta exige público de origem com pelo menos 100 pessoas do mesmo país)." },
      { nome: "Remarketing", quando: "Visitantes da página e quem iniciou checkout nos últimos 7–30 dias, com orçamento pequeno." },
    ],
    regrasCorte: [
      maxCpa
        ? `Criativo com ${fmtBRL(r2(3 * maxCpa))} gastos e nenhuma venda: pausar (chance de ser azar ≤ 5%). Entre ${fmtBRL(r2(1.6 * maxCpa))} e esse valor sem venda: alerta, revise gancho e página.`
        : "Corte por falta de venda quando o gasto chegar a 3× o CPA máximo.",
      "Com vendas: só considere prejuízo comprovado quando o melhor caso do intervalo de 95% do CPA estiver acima do máximo (o painel calcula).",
      "Vendas sem origem identificada impedem concluir prejuízo de um criativo — corrija o rastreamento antes.",
      "Pix e boleto pendentes contam em até 2 dias: não corte no mesmo dia do pico de gasto.",
    ],
    regrasEscala: [
      "Só aumente orçamento com lucro comprovado (pior caso do intervalo de 95% do CPA abaixo do máximo), 3+ dias de veiculação e confiança moderada ou alta.",
      "Tamanho do passo proporcional à folga do CPA (o painel sugere), não um percentual fixo. Reavalie após 2–3 dias ou +10 vendas.",
      "Para crescer sem reiniciar o aprendizado, duplique o conjunto vencedor em um público novo (escala horizontal) ou leve os criativos vencedores para uma campanha CBO.",
    ],
    nomenclatura: {
      campanha: `[${prod}]_vendas_teste_${ddmm}`,
      conjunto: "[produto]_[ângulo]_[público]",
      anuncio: "[produto]_[ângulo]_[público]_[criativo]_[data ddmm]",
      exemplos: conjuntos.flatMap((c) => c.anuncios.slice(0, 1)),
    },
    utms: UTM_TEMPLATE,
    checklist: [
      "Script de tracking no <head> da página publicada (Conexões → Script → verificador verde).",
      "Botões de compra como links para o checkout da Cakto (o script leva o sck).",
      "Webhook da Cakto ativo e Purchase do Pixel DESATIVADO dentro da Cakto (evita compra em dobro).",
      "Produto cadastrado em Configurações com preço e custos; campanha vinculada ao produto depois da 1ª sincronização.",
      "Parâmetros de URL (UTMs acima) colados em TODOS os anúncios.",
      "Nomes de campanha, conjuntos e anúncios no padrão acima.",
      "Revisão de políticas (aba Conformidade) antes de publicar.",
      "Orçamento diário que caiba no teste completo sem ansiedade de cortar cedo.",
    ],
    avisos,
  };
}

/**
 * Passo a passo no Gerenciador de Anúncios. O sistema é consultivo: não cria nem
 * altera campanhas no Meta — você monta seguindo estes passos.
 */
export function adsManagerSteps(s: CampaignStructure, opts: { pageUrl: string | null; pixelId: string | null }): string[] {
  const c0 = s.teste.conjuntos[0];
  return [
    `Gerenciador de Anúncios → Criar → objetivo **Vendas**. Nome da campanha: \`${s.nomenclatura.campanha}\`.`,
    "Na campanha, deixe o orçamento no nível do conjunto (ABO) — desligue o orçamento da campanha (Advantage+ campaign budget) durante o teste.",
    `Conjunto: local da conversão **Site**, conjunto de dados/Pixel ${opts.pixelId ? `**${opts.pixelId}**` : "do seu site"} e evento **Compra**.`,
    s.teste.orcamentoPorCriativo
      ? `Orçamento diário por conjunto: o suficiente para cada criativo chegar a ~${fmtBRL(s.teste.orcamentoPorCriativo)} de gasto em poucos dias${s.teste.orcamentoDiario ? ` (seu total: ${fmtBRL(s.teste.orcamentoDiario)}/dia ÷ ${s.teste.conjuntos.length} conjuntos)` : ""}.`
      : "Orçamento diário por conjunto: defina o preço do produto no kit para calcular.",
    `Público: Brasil, 18–65, sem interesses (amplo); posicionamentos Advantage+. Nome do conjunto: \`${c0?.nome ?? "[produto]_[ângulo]_amplo"}\`.`,
    `Anúncios: 3 por conjunto com os roteiros do kit; nomes no padrão (ex.: \`${c0?.anuncios[0] ?? s.nomenclatura.anuncio}\`).`,
    `URL do site: ${opts.pageUrl ? `**${opts.pageUrl}**` : "a página publicada (com o script de tracking)"}. Em **Parâmetros de URL**, cole: \`${s.utms}\``,
    "Duplique o conjunto para os outros ângulos, troque os criativos e os nomes, revise e publique.",
    "Depois da 1ª sincronização (até 1 hora), vincule a campanha ao produto em Configurações → Produtos para o painel calcular CPA e decisões.",
  ];
}
