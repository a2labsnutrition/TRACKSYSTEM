import { fmtBRL, fmtDec, fmtInt, fmtPct } from "@/lib/format";
import { deriveMetrics, type MetaTotals } from "@/lib/metrics/compute";
import { assessConfidence, type ConfidenceAssessment, type ConfidenceLevel } from "@/lib/stats/confidence";
import { cpaInterval, poissonCdf, probZeroPurchases, purchasesToConclude, spendForZeroProbability, type CpaInterval } from "@/lib/stats/core";
import { safeDiv } from "@/lib/utils";

/**
 * Motor de decisão (camada determinística). Princípios:
 *  1. Decide contra o CPA DE EQUILÍBRIO (margem real do produto), não contra regras fixas.
 *  2. Considera a incerteza: compras ~ Poisson; lucro/prejuízo só é "comprovado" quando o
 *     intervalo de 95% do CPA fica inteiro de um lado do equilíbrio.
 *  3. Nunca escala com menos de 3 dias de veiculação nem com confiança baixa.
 *  4. Vendas sem origem identificada impedem conclusões de prejuízo ("pode ter sido esta campanha").
 *  5. Prefere "dados insuficientes" a uma recomendação sem fundamento.
 * Consultivo: o sistema nunca altera campanhas.
 */

export type DecisionStatus = "escalar" | "manter" | "otimizar" | "pausar" | "aguardar";
export type Severity = "info" | "atencao" | "critico" | "positivo";

export interface DecisionConfig {
  /** CPA desejado (zona confortável). Padrão: 70% do equilíbrio. */
  targetCpa: number;
  /** CPA máximo tolerável. Padrão: o CPA de equilíbrio (acima dele, cada venda dá prejuízo). */
  maxCpa: number;
  minRoas: number;
  /**
   * Sensibilidade do corte por falta de venda: o sinal é forte quando a chance de 0 vendas
   * (se o CPA fosse o máximo) cai abaixo de e^-k. k = 3 → 5%; k = 2 → 13,5%.
   */
  killSpendMultiple: number;
  minLinkClicks: number;
  /** Compras mínimas (7 dias) antes de recomendar aumento de orçamento. */
  minPurchasesToScale: number;
  connectRateMin: number;
  frequencyMax: number;
  /** Gasto mínimo de teste (R$) antes de qualquer corte por falta de venda. 0 = só o critério estatístico. */
  minTestBudget: number;
  /** CPA de equilíbrio e de onde veio. */
  breakevenCpa?: number | null;
  breakevenSource?: "produto" | "medido" | "configurado" | "padrao";
}

export const DEFAULT_DECISION_CONFIG: DecisionConfig = {
  targetCpa: 60,
  maxCpa: 90,
  minRoas: 1.5,
  killSpendMultiple: 3,
  minLinkClicks: 100,
  minPurchasesToScale: 5,
  connectRateMin: 0.75,
  frequencyMax: 2.5,
  minTestBudget: 0,
  breakevenCpa: null,
  breakevenSource: "padrao",
};

/** Campos que o usuário pode ajustar por produto (as metas de CPA/ROAS ficam no produto). */
export const RULE_OVERRIDE_KEYS = ["killSpendMultiple", "minLinkClicks", "minPurchasesToScale", "connectRateMin", "frequencyMax", "minTestBudget"] as const;

/**
 * Metas a partir do produto. O CPA de equilíbrio considera preço, taxa da Cakto,
 * impostos e custos variáveis do produto (quando `ws` é informado).
 */
export function configFromProduct(
  p: {
    price?: number;
    netPerSale: number | null;
    targetCpa: number | null;
    maxCpa: number | null;
    minRoas: number | null;
    rules?: Partial<DecisionConfig>;
    costPerSale?: number;
    costPct?: number;
  },
  ws: { taxRate: number; defaultFeeRate: number } = { taxRate: 0, defaultFeeRate: 0 },
): DecisionConfig {
  const price = p.price ?? p.netPerSale ?? 0;
  const net = p.netPerSale ?? (price ? price * (1 - ws.defaultFeeRate) : null);
  const breakeven = net != null ? Math.max(0, net - price * (ws.taxRate + (p.costPct ?? 0)) - (p.costPerSale ?? 0)) : null;
  const maxCpa = p.maxCpa ?? breakeven ?? DEFAULT_DECISION_CONFIG.maxCpa;
  const targetCpa = p.targetCpa ?? (breakeven ? breakeven * 0.7 : DEFAULT_DECISION_CONFIG.targetCpa);
  const minRoas = p.minRoas ?? (price && maxCpa ? price / maxCpa : DEFAULT_DECISION_CONFIG.minRoas);
  const overrides: Partial<DecisionConfig> = {};
  for (const k of RULE_OVERRIDE_KEYS) {
    const v = p.rules?.[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) overrides[k] = v;
  }
  return {
    ...DEFAULT_DECISION_CONFIG,
    ...overrides,
    targetCpa,
    maxCpa,
    minRoas,
    breakevenCpa: breakeven,
    breakevenSource: p.maxCpa != null ? "configurado" : breakeven != null ? "produto" : "padrao",
  };
}

export interface Signal {
  code: string;
  severity: Severity;
  message: string;
  /** Números que sustentam o sinal (vão para a IA e para a UI). */
  evidence: Record<string, number | string | null>;
}

export interface WindowData {
  meta: MetaTotals;
  /** Compras PRINCIPAIS pagas com origem confirmada ou provável nesta entidade. */
  realPurchases: number;
  realNetRevenue: number;
  /** Só as de origem confirmada. */
  confirmedPurchases?: number;
  /** Compras principais SEM origem no mesmo período (todo o workspace). Podem ser desta entidade. */
  unattributedPurchases?: number;
  grossRevenue?: number;
}

export interface DecisionInput {
  last1d: WindowData;
  last3d: WindowData;
  last7d: WindowData;
  /** Tracking confiável? (ex.: script instalado, webhook recebendo) */
  trackingOk: boolean;
  learningPhase?: boolean;
  config: DecisionConfig;
  /** Os 4 dias anteriores à janela de 3 dias (para detectar saturação). */
  prev4d?: WindowData;
  /** Anúncios com fadiga detectada (nomes). */
  fatiguedAds?: string[];
  /** Anúncios ativos com gasto nos últimos 7 dias. */
  activeAds?: number;
  /** Dias com gasto nos últimos 7 (tempo de veiculação). Padrão: 7. */
  daysActive?: number;
  /** Valor diário (ex.: ROAS) para medir a estabilidade. */
  dailyValues?: number[];
  /** Fração das vendas do período com origem identificada (null = sem vendas). */
  attributionCoverage?: number | null;
  /** Orçamento diário atual (R$), para estimar impactos. */
  dailyBudget?: number | null;
  /** Problemas de integridade dos dados (ex.: gasto sem cotação). Impedem escalar. */
  dataIssues?: string[];
}

export type RecommendationAction =
  | "manter"
  | "aumentar_gradual"
  | "escala_horizontal"
  | "variacoes_criativo"
  | "reduzir"
  | "pausar"
  | "aguardar"
  | "corrigir_tracking"
  | "otimizar_funil";

export interface Recommendation {
  action: RecommendationAction;
  title: string;
  /** Dados que justificam. */
  justification: string[];
  confidence: ConfidenceLevel;
  risks: string[];
  /** Impacto financeiro estimado (null quando não dá para calcular de forma válida). */
  impact: { text: string; lowPerDay: number | null; highPerDay: number | null } | null;
  /** O que invalidaria esta recomendação. */
  invalidation: string[];
  /** Quando/quanto de dado para reavaliar. */
  reassess: string;
  /** "Como calculamos". */
  calc: Array<{ label: string; formula: string; value: string }>;
  priority: number;
}

export type Evidence = "lucrativo" | "deficitario" | "inconclusivo" | "sem_vendas" | "alerta_sem_vendas" | "deficitario_sem_vendas" | "vendas_sem_origem";

export interface DecisionResult {
  status: DecisionStatus;
  confidence: ConfidenceLevel;
  confidenceDetail: ConfidenceAssessment;
  evidence: Evidence;
  signals: Signal[];
  /** Quando faltam dados: quanto falta. */
  missingData: string | null;
  headline: string;
  recommendations: Recommendation[];
  cpa: CpaInterval;
  /** CPA máximo usado na decisão (equilíbrio ou o configurado). */
  limitCpa: number;
}

export const STATUS_LABEL: Record<DecisionStatus, string> = {
  escalar: "Escalar",
  manter: "Manter",
  otimizar: "Otimizar",
  pausar: "Pausar",
  aguardar: "Aguardar dados",
};

export const ACTION_LABEL: Record<RecommendationAction, string> = {
  manter: "Manter o orçamento",
  aumentar_gradual: "Aumentar o orçamento gradualmente",
  escala_horizontal: "Testar escala horizontal",
  variacoes_criativo: "Criar variações de criativo",
  reduzir: "Reduzir investimento",
  pausar: "Pausar",
  aguardar: "Aguardar mais dados",
  corrigir_tracking: "Corrigir o rastreamento",
  otimizar_funil: "Otimizar o funil",
};

export const INSUFFICIENT_SCALE = "Dados insuficientes para recomendar escalonamento.";

const r2 = (v: number) => Math.round(v * 100) / 100;

export function evaluate(input: DecisionInput): DecisionResult {
  const { config: c } = input;
  const w7 = input.last7d;
  const w3 = input.last3d;
  const signals: Signal[] = [];
  const d7 = deriveMetrics(w7.meta);
  const d3 = deriveMetrics(w3.meta);
  const spend7 = w7.meta.spend;
  const k = w7.realPurchases;
  const pool = w7.unattributedPurchases ?? 0;
  const kMax = k + pool;
  const limit = c.maxCpa;
  const days = input.daysActive ?? 7;
  const early = days < 3;

  const confidenceDetail = assessConfidence({
    purchases: k,
    spend: spend7,
    daysWithSpend: days,
    linkClicks: w7.meta.linkClicks,
    attributionCoverage: input.attributionCoverage ?? (k + pool > 0 ? k / (k + pool) : null),
    trackingOk: input.trackingOk,
    dailyValues: input.dailyValues,
  });
  const confidence = confidenceDetail.level;

  // --------------------------- sinais de diagnóstico ---------------------------
  if (!input.trackingOk) {
    signals.push({ code: "tracking_quebrado", severity: "critico", message: "Rastreamento com problema: recomendação sem dado confiável é pior que nenhuma. Corrija as conexões primeiro.", evidence: {} });
  }
  for (const issue of input.dataIssues ?? []) {
    signals.push({ code: "dados_incompletos", severity: "critico", message: issue, evidence: {} });
  }
  if (c.breakevenSource === "padrao") {
    signals.push({
      code: "sem_margem",
      severity: "atencao",
      message: `Campanha sem produto vinculado: o CPA máximo de ${fmtBRL(limit)} é um valor padrão, não a sua margem. Vincule o produto (Configurações) para decisões de orçamento.`,
      evidence: { maxCpa: limit },
    });
  }
  if (d7.connectRate != null && w7.meta.linkClicks >= 50 && d7.connectRate < c.connectRateMin) {
    signals.push({
      code: "connect_rate_baixo",
      severity: d7.connectRate < 0.6 ? "critico" : "atencao",
      message: `Connect rate ${fmtPct(d7.connectRate, 0)} < ${fmtPct(c.connectRateMin, 0)}: cliques se perdem antes da página carregar.`,
      evidence: { connectRate: d7.connectRate, linkClicks: w7.meta.linkClicks, lpv: w7.meta.landingPageViews },
    });
  }
  if (d3.frequency != null && d3.frequency > c.frequencyMax) {
    signals.push({
      code: "frequencia_alta",
      severity: "atencao",
      message: `Frequência ${fmtDec(d3.frequency, 1)} > ${fmtDec(c.frequencyMax, 1)} nos últimos 3 dias: risco de saturação/fadiga.`,
      evidence: { frequency3d: d3.frequency },
    });
  }
  if (d7.ctrLink != null && w7.meta.impressions >= 3000 && d7.ctrLink < 0.008) {
    signals.push({
      code: "ctr_baixo",
      severity: "atencao",
      message: `CTR de link ${fmtPct(d7.ctrLink, 2)} abaixo de 0,8%: o criativo não está gerando clique (sozinho não prova a causa).`,
      evidence: { ctrLink: d7.ctrLink, impressions: w7.meta.impressions },
    });
  }
  if (d7.hookRate != null && w7.meta.video3s > 0 && w7.meta.impressions >= 3000 && d7.hookRate < 0.2) {
    signals.push({ code: "hook_baixo", severity: "atencao", message: `Hook rate ${fmtPct(d7.hookRate, 0)} < 20%: os 3 primeiros segundos não param a rolagem.`, evidence: { hookRate: d7.hookRate } });
  }
  if (d7.checkoutRate != null && w7.meta.landingPageViews >= 150 && d7.checkoutRate < 0.05) {
    signals.push({
      code: "pagina_nao_converte",
      severity: "atencao",
      message: `Só ${fmtPct(d7.checkoutRate, 1)} das visitas iniciam checkout: página/oferta pode não estar convencendo.`,
      evidence: { checkoutRate: d7.checkoutRate, lpv: w7.meta.landingPageViews },
    });
  }
  if (d7.ctrLink != null && d7.ctrLink >= 0.015 && w7.meta.landingPageViews >= 200 && (d7.checkoutRate ?? 1) < 0.04) {
    signals.push({
      code: "desalinhamento",
      severity: "info",
      message: `CTR alto (${fmtPct(d7.ctrLink, 2)}) com poucos checkouts (${fmtPct(d7.checkoutRate, 1)}): possível desalinhamento entre anúncio, oferta e página — não prova qual etapa causa o problema.`,
      evidence: { ctrLink: d7.ctrLink, checkoutRate: d7.checkoutRate },
    });
  }
  if (input.prev4d && input.prev4d.meta.impressions > 2000 && w3.meta.impressions > 1500) {
    const dp = deriveMetrics(input.prev4d.meta);
    const cpmUp = dp.cpm && d3.cpm ? (d3.cpm - dp.cpm) / dp.cpm : null;
    const reachPerReal3 = safeDiv(w3.meta.reachSum, w3.meta.spend);
    const reachPerRealPrev = safeDiv(input.prev4d.meta.reachSum, input.prev4d.meta.spend);
    const reachDrop = reachPerReal3 != null && reachPerRealPrev ? (reachPerRealPrev - reachPerReal3) / reachPerRealPrev : null;
    if (cpmUp != null && cpmUp >= 0.2 && (d3.frequency ?? 0) >= 2 && (reachDrop ?? 0) >= 0.15) {
      signals.push({
        code: "saturacao_publico",
        severity: "atencao",
        message: `Sinais de saturação: CPM subiu ${fmtPct(cpmUp, 0)}, frequência ${fmtDec(d3.frequency, 1)} e alcance novo por R$ caiu ${fmtPct(reachDrop, 0)} vs. os 4 dias anteriores.`,
        evidence: { cpmChange: cpmUp, frequency3d: d3.frequency, reachPerRealDrop: reachDrop },
      });
    }
  }
  const fatigued = input.fatiguedAds ?? [];
  if (fatigued.length) {
    const share = input.activeAds ? fatigued.length / input.activeAds : null;
    signals.push({
      code: "criativos_em_fadiga",
      severity: share != null && share >= 0.5 ? "atencao" : "info",
      message: `${fatigued.length} criativo(s) em fadiga (${fatigued.slice(0, 3).join(", ")}${fatigued.length > 3 ? "…" : ""}): prepare novos ganchos.`,
      evidence: { fatiguedAds: fatigued.length, activeAds: input.activeAds ?? null },
    });
  }
  if (input.learningPhase) {
    signals.push({ code: "fase_aprendizado", severity: "info", message: "Em fase de aprendizado: evite edições significativas (orçamento, público, criativo).", evidence: {} });
  }
  if (early && spend7 > 0) {
    signals.push({
      code: "pouco_tempo",
      severity: "info",
      message: `Só ${days} dia(s) de veiculação: o resultado de um dia oscila com o leilão e com vendas que ainda vão ser pagas (Pix/boleto).`,
      evidence: { daysActive: days },
    });
  }

  // --------------------------- evidência econômica ---------------------------
  const ciAttr = cpaInterval(spend7, k); // conservador para LUCRO (menos compras)
  const ciMax = cpaInterval(spend7, kMax); // conservador para PREJUÍZO (mais compras possíveis)
  const killP = Math.exp(-c.killSpendMultiple);
  let evidence: Evidence;
  let p0: number | null = null;

  if (kMax === 0) {
    p0 = spend7 > 0 ? probZeroPurchases(spend7, limit) : 1;
    evidence = p0 <= killP ? "deficitario_sem_vendas" : p0 <= 0.2 ? "alerta_sem_vendas" : "sem_vendas";
    // orçamento mínimo de teste definido por você no produto: antes dele, nenhum veredito de corte
    if (c.minTestBudget > 0 && spend7 < c.minTestBudget) evidence = "sem_vendas";
    if (evidence !== "sem_vendas") {
      signals.push({
        code: "gasto_sem_venda",
        severity: evidence === "deficitario_sem_vendas" ? "critico" : "atencao",
        message: `${fmtBRL(spend7)} de gasto sem nenhuma venda. Se o CPA real fosse ${fmtBRL(limit)} (máximo tolerável), a chance de zero vendas seria de ${fmtPct(p0, p0 < 0.01 ? 1 : 0)}.`,
        evidence: { spend7d: spend7, maxCpa: limit, probZero: p0 },
      });
    }
  } else if (k === 0 && pool > 0) {
    evidence = "vendas_sem_origem";
    signals.push({
      code: "vendas_sem_origem",
      severity: "atencao",
      message: `Nenhuma venda com origem identificada nesta campanha, mas há ${pool} venda(s) sem origem no período — podem ter vindo daqui. Não é possível concluir lucro ou prejuízo.`,
      evidence: { unattributed: pool },
    });
  } else if (ciAttr.upper != null && ciAttr.upper < limit) {
    evidence = "lucrativo";
    signals.push({
      code: "cpa_saudavel",
      severity: "positivo",
      message: `CPA ${fmtBRL(ciAttr.point)} com ${k} venda(s); mesmo no pior caso do intervalo de 95% (${fmtBRL(ciAttr.upper)}) fica abaixo do máximo de ${fmtBRL(limit)}.`,
      evidence: { cpa: ciAttr.point, cpaUpper: ciAttr.upper, maxCpa: limit, purchases: k },
    });
  } else if (ciMax.lower != null && ciMax.lower > limit) {
    evidence = "deficitario";
    signals.push({
      code: "cpa_acima_max",
      severity: "critico",
      message: `CPA ${fmtBRL(ciMax.point)} acima do máximo de ${fmtBRL(limit)}; mesmo no melhor caso do intervalo de 95% (${fmtBRL(ciMax.lower)}) cada venda dá prejuízo.`,
      evidence: { cpa: ciMax.point, cpaLower: ciMax.lower, maxCpa: limit, purchases: kMax },
    });
  } else {
    evidence = "inconclusivo";
    const need = ciAttr.point != null ? purchasesToConclude(ciAttr.point, limit) : null;
    signals.push({
      code: "cpa_inconclusivo",
      severity: ciAttr.point != null && ciAttr.point > limit ? "atencao" : "info",
      message: `CPA ${fmtBRL(ciAttr.point)} com ${k} venda(s): o intervalo de 95% (${fmtBRL(ciAttr.lower)} a ${fmtBRL(ciAttr.upper)}) ainda inclui o máximo de ${fmtBRL(limit)}${need ? ` — com o CPA atual, seriam necessárias ~${need} vendas para concluir` : ""}.`,
      evidence: { cpa: ciAttr.point, cpaLower: ciAttr.lower, cpaUpper: ciAttr.upper, maxCpa: limit, purchasesNeeded: need },
    });
  }
  // Chance de ver tão poucas vendas (contando as sem origem) se o CPA real fosse o máximo
  const pFew = evidence === "inconclusivo" && spend7 > 0 && kMax > 0 ? poissonCdf(kMax, spend7 / limit) : null;
  const roas7 = safeDiv(w7.grossRevenue ?? w7.realNetRevenue, spend7);
  if (roas7 != null && k >= 10 && roas7 < c.minRoas) {
    signals.push({ code: "roas_abaixo_min", severity: "atencao", message: `ROAS ${fmtDec(roas7, 2)}x abaixo do mínimo ${fmtDec(c.minRoas, 2)}x.`, evidence: { roas7d: roas7, minRoas: c.minRoas } });
  }

  // --------------------------- status ---------------------------
  const critical = signals.some((s) => s.severity === "critico" && s.code !== "cpa_acima_max" && s.code !== "gasto_sem_venda");
  const attention = signals.some((s) => s.severity === "atencao");
  let status: DecisionStatus;
  switch (evidence) {
    case "deficitario_sem_vendas":
      status = early && (p0 ?? 1) > 0.01 ? "otimizar" : "pausar";
      break;
    case "deficitario":
      status = ciMax.lower != null && ciMax.lower > limit * 1.3 && !early ? "pausar" : "otimizar";
      break;
    case "alerta_sem_vendas":
      status = "otimizar";
      break;
    case "vendas_sem_origem":
    case "sem_vendas":
      status = "aguardar";
      break;
    case "lucrativo": {
      const canScale =
        !early && confidence !== "baixa" && k >= c.minPurchasesToScale && input.trackingOk && !critical && c.breakevenSource !== "padrao" && !(input.dataIssues ?? []).length;
      status = canScale ? "escalar" : "manter";
      break;
    }
    default:
      // CPA bem acima do máximo e POUCO provável se o CPA real fosse o máximo (≤ 20%, mesmo limiar do alerta sem venda)
      if (!early && pFew != null && pFew <= 0.2 && (ciMax.point ?? 0) > limit * 1.5) status = "otimizar";
      else status = early || k < 3 ? "aguardar" : attention || critical || (ciAttr.point ?? 0) > limit ? "otimizar" : "manter";
  }
  if ((!input.trackingOk || (input.dataIssues ?? []).length) && status === "escalar") status = "manter";

  // --------------------------- dados faltantes ---------------------------
  let missingData: string | null = null;
  if (status === "aguardar" || (evidence === "inconclusivo" && status !== "pausar")) {
    const parts: string[] = [];
    if (evidence === "sem_vendas" && c.minTestBudget > 0 && spend7 < c.minTestBudget)
      parts.push(`atingir o orçamento mínimo de teste de ${fmtBRL(c.minTestBudget)} (faltam ${fmtBRL(c.minTestBudget - spend7)})`);
    else if (evidence === "sem_vendas") parts.push(`sem vendas ainda; com ${fmtBRL(spendForZeroProbability(limit, killP))} de gasto sem venda o sinal de prejuízo ficaria forte`);
    if (evidence === "inconclusivo" && ciAttr.point) {
      const need = purchasesToConclude(ciAttr.point, limit);
      if (need) parts.push(`~${need} vendas (≈ ${fmtBRL(need * ciAttr.point)} de gasto no CPA atual) para o intervalo do CPA sair de cima do equilíbrio`);
    }
    if (evidence === "vendas_sem_origem") parts.push("identificar a origem das vendas (script na página + parâmetro no checkout)");
    if (early) parts.push(`pelo menos 3 dias de veiculação (hoje: ${days})`);
    missingData = parts.length ? `Falta: ${parts.join("; ")}.` : null;
  }

  const recommendations = buildRecommendations({ input, status, evidence, confidence, ciAttr, ciMax, p0, pFew, signals, limit, days, early });
  return {
    status,
    confidence,
    confidenceDetail,
    evidence,
    signals,
    missingData,
    headline: headlineFor(status, evidence, signals, missingData, k, days),
    recommendations,
    cpa: ciAttr,
    limitCpa: limit,
  };
}

function headlineFor(status: DecisionStatus, evidence: Evidence, signals: Signal[], missing: string | null, k: number, days: number): string {
  const top = signals.find((s) => s.severity === "critico") ?? signals.find((s) => s.severity === "atencao");
  if (status === "aguardar") {
    if (evidence === "vendas_sem_origem") return `${INSUFFICIENT_SCALE} As vendas do período não têm origem identificada.`;
    return `${INSUFFICIENT_SCALE} ${k} venda(s) em ${days} dia(s). ${missing ?? ""}`.trim();
  }
  switch (status) {
    case "pausar":
      return top?.message ?? "Prejuízo comprovado com os dados atuais.";
    case "escalar":
      return signals.find((s) => s.code === "cpa_saudavel")?.message ?? "Lucro comprovado com volume.";
    case "otimizar":
      return top?.message ?? "Há pontos de melhoria.";
    default:
      return evidence === "lucrativo"
        ? `${signals.find((s) => s.code === "cpa_saudavel")?.message ?? ""} Ainda sem volume/estabilidade para aumentar com segurança.`.trim()
        : "Dentro do esperado. Mantenha e acompanhe.";
  }
}

// ============================ recomendações ============================

interface RecCtx {
  input: DecisionInput;
  status: DecisionStatus;
  evidence: Evidence;
  confidence: ConfidenceLevel;
  ciAttr: CpaInterval;
  ciMax: CpaInterval;
  p0: number | null;
  pFew: number | null;
  signals: Signal[];
  limit: number;
  days: number;
  early: boolean;
}

function cpaCalc(x: RecCtx): Recommendation["calc"] {
  const w7 = x.input.last7d;
  const calc: Recommendation["calc"] = [
    {
      label: "CPA da campanha (7 dias)",
      formula: "gasto ÷ compras principais com origem (confirmada ou provável)",
      value: w7.realPurchases > 0 ? `${fmtBRL(w7.meta.spend)} ÷ ${w7.realPurchases} = ${fmtBRL(x.ciAttr.point)}` : `${fmtBRL(w7.meta.spend)} sem compras com origem: CPA indefinido`,
    },
  ];
  if (w7.realPurchases > 0 && (x.ciAttr.lower != null || x.ciAttr.upper != null))
    calc.push({ label: "Intervalo de 95% do CPA", formula: "Poisson exato (Garwood) sobre o número de compras", value: `${fmtBRL(x.ciAttr.lower)} a ${x.ciAttr.upper == null ? "∞" : fmtBRL(x.ciAttr.upper)}` });
  calc.push({
    label: "CPA máximo (equilíbrio)",
    formula:
      x.input.config.breakevenSource === "configurado"
        ? "definido por você no produto"
        : "contribuição por venda antes de anúncios (preço − taxa Cakto − impostos − custos variáveis)",
    value: fmtBRL(x.limit),
  });
  if ((w7.unattributedPurchases ?? 0) > 0) calc.push({ label: "Vendas sem origem no período", formula: "podem ter vindo desta campanha; não somadas ao CPA", value: fmtInt(w7.unattributedPurchases ?? 0) });
  if (x.p0 != null) calc.push({ label: "Chance de 0 vendas no CPA máximo", formula: "e^(−gasto ÷ CPA máximo)", value: fmtPct(x.p0, 1) });
  return calc;
}

function budgetPerDay(x: RecCtx): number | null {
  if (x.input.dailyBudget && x.input.dailyBudget > 0) return x.input.dailyBudget;
  const s = x.input.last7d.meta.spend;
  return s > 0 ? s / Math.max(1, x.days) : null;
}

function buildRecommendations(x: RecCtx): Recommendation[] {
  const recs: Recommendation[] = [];
  const w7 = x.input.last7d;
  const k = w7.realPurchases;
  const budget = budgetPerDay(x);
  const point = x.ciAttr.point;
  const base = (r: Omit<Recommendation, "calc"> & { calc?: Recommendation["calc"] }): Recommendation => ({ ...r, calc: r.calc ?? cpaCalc(x) });

  const issues = x.input.dataIssues ?? [];
  const lowCoverage = x.input.attributionCoverage != null && x.input.attributionCoverage < 0.6;
  if (!x.input.trackingOk || issues.length || x.evidence === "vendas_sem_origem" || lowCoverage) {
    const why: string[] = [...issues];
    if (!x.input.trackingOk) why.push("Conexões de rastreamento com problema (veja Saúde do tracking).");
    if (x.evidence === "vendas_sem_origem") why.push(`${w7.unattributedPurchases} venda(s) no período sem origem identificada.`);
    else if (lowCoverage) why.push(`Só ${fmtPct(x.input.attributionCoverage, 0)} das vendas do período têm origem identificada.`);
    if (x.evidence === "vendas_sem_origem" || lowCoverage)
      why.push("Sem origem, não dá para saber qual campanha ou criativo vendeu — e o sistema não atribui vendas por quem gastou mais.");
    recs.push(
      base({
        action: "corrigir_tracking",
        title: issues.length ? "Corrigir os dados antes de decidir orçamento" : "Corrigir o rastreamento antes de decidir orçamento",
        justification: why,
        confidence: "alta",
        risks: ["Decidir orçamento agora pode pausar a campanha que de fato vendeu."],
        impact: null,
        invalidation: ["Se as próximas vendas chegarem com origem identificada (sck/UTM), esta recomendação deixa de valer."],
        reassess: "Assim que 3 vendas novas chegarem com origem identificada.",
        priority: 100,
      }),
    );
  }

  switch (x.evidence) {
    case "lucrativo": {
      const upper = x.ciAttr.upper ?? point ?? x.limit;
      const headroom = Math.max(0, (x.limit - upper) / x.limit);
      if (x.status === "escalar" && budget) {
        // incremento proporcional à folga conservadora e à confiança (sem regra fixa)
        const factor = x.confidence === "alta" ? 0.6 : 0.35;
        const inc = Math.min(0.3, Math.max(0.05, Math.round((headroom * factor) / 0.05) * 0.05));
        const delta = r2(budget * inc);
        const be = x.limit;
        const low = point ? r2(delta * (be / (point * 1.3) - 1)) : null;
        const high = point ? r2(delta * (be / point - 1)) : null;
        recs.push(
          base({
            action: "aumentar_gradual",
            title: `Aumentar o orçamento em ~${Math.round(inc * 100)}% (${fmtBRL(budget)} → ${fmtBRL(budget + delta)}/dia)`,
            justification: [
              `CPA ${fmtBRL(point)} com ${k} vendas; pior caso do intervalo de 95%: ${fmtBRL(upper)} (folga de ${fmtPct(headroom, 0)} até o máximo de ${fmtBRL(x.limit)}).`,
              `Tamanho do passo proporcional à folga e à confiança (${x.confidence}) — não é um percentual fixo.`,
            ],
            confidence: x.confidence,
            risks: [
              "O CPA marginal costuma piorar quando o orçamento sobe.",
              ...(x.input.learningPhase ? ["Conjuntos em aprendizado: aumentos grandes reiniciam o aprendizado."] : []),
            ],
            impact:
              low != null && high != null
                ? { text: `Lucro de contribuição adicional estimado entre ${fmtBRL(low)} e ${fmtBRL(high)} por dia, supondo CPA marginal entre o atual e 30% pior.`, lowPerDay: low, highPerDay: high }
                : null,
            invalidation: [`CPA de 3 dias acima de ${fmtBRL(x.limit)}.`, "Queda na taxa de aprovação de pagamentos.", `Frequência acima de ${fmtDec(x.input.config.frequencyMax, 1)}.`],
            reassess: "Após 2–3 dias ou +10 vendas, o que vier primeiro. Só então considerar novo passo.",
            priority: 80,
          }),
        );
        if (x.signals.some((s) => s.code === "frequencia_alta" || s.code === "saturacao_publico") || x.input.learningPhase) {
          recs.push(
            base({
              action: "escala_horizontal",
              title: "Duplicar o conjunto vencedor em um público novo",
              justification: ["Há sinal de saturação/frequência ou conjunto em aprendizado: crescer em público novo preserva o original."],
              confidence: x.confidence === "alta" ? "moderada" : "baixa",
              risks: ["O novo conjunto passa por aprendizado e pode ter CPA maior nos primeiros dias."],
              impact: null,
              invalidation: ["Se o novo público tiver CPA acima do máximo após gastar 3× o CPA máximo."],
              reassess: "Após o novo conjunto gastar ~3× o CPA máximo.",
              priority: 60,
            }),
          );
        }
      } else {
        recs.push(
          base({
            action: "manter",
            title: "Manter o orçamento — resultado positivo, mas ainda sem base para aumentar",
            justification: [
              `CPA ${fmtBRL(point)} abaixo do máximo de ${fmtBRL(x.limit)} mesmo no pior caso do intervalo (${fmtBRL(upper)}).`,
              INSUFFICIENT_SCALE,
              x.early ? `Só ${x.days} dia(s) de veiculação.` : `Confiança ${x.confidence} ou menos de ${x.input.config.minPurchasesToScale} vendas.`,
            ],
            confidence: x.confidence,
            risks: ["Resultado de poucos dias pode não se repetir."],
            impact: null,
            invalidation: [`CPA de 3 dias acima de ${fmtBRL(x.limit)}.`],
            reassess: x.early ? "Quando completar 3 dias de veiculação." : `Quando chegar a ${x.input.config.minPurchasesToScale} vendas em 7 dias.`,
            priority: 70,
          }),
        );
      }
      break;
    }
    case "deficitario":
    case "deficitario_sem_vendas": {
      const lossPerDay = budget && point ? r2(budget * (1 - x.limit / point)) : null;
      const pause = x.status === "pausar";
      recs.push(
        base({
          action: pause ? "pausar" : "reduzir",
          title: pause ? "Pausar a campanha (ou os conjuntos sem venda)" : "Reduzir o investimento e corrigir o gargalo",
          justification:
            x.evidence === "deficitario_sem_vendas"
              ? [`${fmtBRL(w7.meta.spend)} sem venda; se o CPA fosse o máximo de ${fmtBRL(x.limit)}, a chance de zero vendas seria de ${fmtPct(x.p0, 1)}.`]
              : [`Melhor caso do intervalo de 95% do CPA: ${fmtBRL(x.ciMax.lower)} — acima do máximo de ${fmtBRL(x.limit)}.`],
          confidence: x.confidence === "baixa" && x.evidence === "deficitario_sem_vendas" && (x.p0 ?? 1) < 0.01 ? "moderada" : x.confidence,
          risks: [
            "Vendas por Pix/boleto ainda não pagas e atrasos de atribuição podem melhorar o número nos próximos dias.",
            ...(x.early ? ["Menos de 3 dias de veiculação: preferimos reduzir a pausar."] : []),
          ],
          impact: lossPerDay != null && lossPerDay > 0 ? { text: `Evita perder ~${fmtBRL(lossPerDay)} por dia no CPA atual.`, lowPerDay: lossPerDay, highPerDay: lossPerDay } : null,
          invalidation: ["Vendas atrasadas (Pix/boleto) ou sem origem que forem atribuídas a esta campanha.", `CPA de 3 dias abaixo de ${fmtBRL(x.limit)}.`],
          reassess: "Em 2 dias (tempo para pagamentos pendentes e atribuição atrasada).",
          priority: 90,
        }),
      );
      break;
    }
    case "alerta_sem_vendas":
      recs.push(
        base({
          action: "otimizar_funil",
          title: "Sem vendas ainda: revisar o funil antes de gastar mais",
          justification: [`${fmtBRL(w7.meta.spend)} sem venda; chance de isso acontecer por acaso no CPA máximo: ${fmtPct(x.p0, 0)} — sinal de alerta, ainda não conclusivo.`],
          confidence: "baixa",
          risks: ["Pausar agora pode cortar uma campanha que só teve azar."],
          impact: null,
          invalidation: ["Uma ou mais vendas com origem nesta campanha."],
          reassess: `Ao atingir ${fmtBRL(spendForZeroProbability(x.limit, Math.exp(-x.input.config.killSpendMultiple)))} de gasto sem venda (sinal forte) ou na primeira venda.`,
          priority: 75,
        }),
      );
      break;
    case "inconclusivo":
    case "sem_vendas":
      if (x.evidence === "inconclusivo" && x.status === "otimizar" && x.pFew != null && x.pFew <= 0.2 && point != null && point > x.limit * 1.5) {
        const lossPerDay = budget ? r2(budget * (1 - x.limit / point)) : null;
        recs.push(
          base({
            action: "reduzir",
            title: "Reduzir a exposição enquanto testa o funil",
            justification: [
              `CPA atual ${fmtBRL(point)} (${fmtDec(point / x.limit, 1)}× o máximo de ${fmtBRL(x.limit)}) com ${k} venda(s).`,
              `Se o CPA real fosse o máximo, a chance de ver só ${x.input.last7d.realPurchases + (x.input.last7d.unattributedPurchases ?? 0)} venda(s) com ${fmtBRL(x.input.last7d.meta.spend)} seria de ${fmtPct(x.pFew, 0)}.`,
              `Ainda não é prejuízo comprovado — o intervalo de 95% (${fmtBRL(x.ciMax.lower)} a ${x.ciMax.upper == null ? "∞" : fmtBRL(x.ciMax.upper)}) inclui o máximo —, mas no ritmo atual cada real gasto rende menos do que custa.`,
            ],
            confidence: "baixa",
            risks: ["Com poucas vendas, o CPA real pode ser bem menor; reduzir (em vez de pausar) preserva o aprendizado."],
            impact: lossPerDay != null && lossPerDay > 0 ? { text: `No CPA atual, cada dia no orçamento cheio custa ~${fmtBRL(lossPerDay)} acima do equilíbrio.`, lowPerDay: lossPerDay, highPerDay: lossPerDay } : null,
            invalidation: [`CPA de 3 dias abaixo de ${fmtBRL(x.limit)}.`, "Vendas atrasadas (Pix/boleto) ou sem origem atribuídas a esta campanha."],
            reassess: "Em 3 dias ou na próxima venda.",
            priority: 85,
          }),
        );
        break;
      }
      recs.push(
        base({
          action: "aguardar",
          title: "Aguardar mais dados antes de mudar o orçamento",
          justification: [
            INSUFFICIENT_SCALE,
            x.evidence === "sem_vendas"
              ? `${fmtBRL(w7.meta.spend)} de gasto ainda é pouco para julgar um CPA máximo de ${fmtBRL(x.limit)}.`
              : `Intervalo de 95% do CPA (${fmtBRL(x.ciAttr.lower)} a ${fmtBRL(x.ciAttr.upper)}) inclui o máximo de ${fmtBRL(x.limit)}.`,
          ],
          confidence: x.confidence,
          risks: ["Mexer cedo demais reinicia o aprendizado e confunde a leitura."],
          impact: null,
          invalidation: ["Sinal forte de prejuízo (muito gasto sem venda) ou de lucro (intervalo inteiro abaixo do máximo)."],
          reassess: x.early ? "Após 3 dias de veiculação." : "Após mais vendas (veja o que falta no topo).",
          priority: 70,
        }),
      );
      break;
  }

  // gargalos do funil
  const leak = x.signals.find((s) => s.code === "connect_rate_baixo" || s.code === "pagina_nao_converte");
  if (leak) {
    recs.push(
      base({
        action: "otimizar_funil",
        title: leak.code === "connect_rate_baixo" ? "Acelerar/verificar a página (cliques se perdem antes de carregar)" : "Revisar página e oferta (poucas visitas iniciam checkout)",
        justification: [leak.message],
        confidence: x.input.last7d.meta.linkClicks >= 300 ? "moderada" : "baixa",
        risks: ["Mudanças na página afetam todas as campanhas que usam a mesma URL."],
        impact: null,
        invalidation: ["Se a taxa voltar ao normal sem mudanças (pode ser oscilação de poucos dias)."],
        reassess: "3 dias depois da mudança, comparando a mesma taxa.",
        calc: [{ label: "Sinal", formula: "taxa de passagem do funil vs. referência", value: leak.message }],
        priority: 65,
      }),
    );
  }
  if (x.signals.some((s) => s.code === "criativos_em_fadiga" || s.code === "hook_baixo" || s.code === "ctr_baixo")) {
    recs.push(
      base({
        action: "variacoes_criativo",
        title: "Produzir variações de criativo (novas aberturas, mesma oferta)",
        justification: x.signals.filter((s) => ["criativos_em_fadiga", "hook_baixo", "ctr_baixo"].includes(s.code)).map((s) => s.message),
        confidence: "moderada",
        risks: ["Trocar oferta e criativo ao mesmo tempo impede saber o que funcionou."],
        impact: null,
        invalidation: ["Se o CTR/hook voltar a subir sem troca."],
        reassess: "Quando cada variação gastar ~2× o CPA máximo.",
        calc: [{ label: "Sinais", formula: "CTR/hook vs. início da veiculação e frequência", value: `${x.signals.length} sinal(is)` }],
        priority: 55,
      }),
    );
  }

  if (!recs.length) {
    recs.push(
      base({
        action: "manter",
        title: "Manter e acompanhar",
        justification: ["Nenhum sinal relevante de lucro ou prejuízo comprovado."],
        confidence: x.confidence,
        risks: [],
        impact: null,
        invalidation: ["Mudança brusca de CPA, CPM ou conversão (veja Anomalias)."],
        reassess: "Em 3 dias.",
        priority: 10,
      }),
    );
  }
  return recs.sort((a, b) => b.priority - a.priority);
}

/** Resultado para campanha pausada/inativa (nada a decidir sobre orçamento). */
export function inactiveDecision(headline = "Campanha pausada."): DecisionResult {
  return {
    status: "manter",
    confidence: "baixa",
    confidenceDetail: { level: "baixa", criteria: [], limiting: [], summary: "Campanha inativa: sem veiculação para avaliar." },
    evidence: "sem_vendas",
    signals: [],
    missingData: null,
    headline,
    recommendations: [],
    cpa: { point: null, lower: null, upper: null, purchases: 0 },
    limitCpa: 0,
  };
}
