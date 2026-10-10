import { deriveMetrics, type MetaTotals } from "@/lib/metrics/compute";
import { fmtBRL, fmtDec, fmtPct } from "@/lib/format";
import { safeDiv } from "@/lib/utils";

/**
 * Camada 1 do motor de decisão: regras determinísticas que geram sinais com
 * severidade e um status. A IA (Fase 2) recebe estes sinais para escrever o
 * Parecer — ela não recalcula nada.
 */

export type DecisionStatus = "escalar" | "manter" | "otimizar" | "pausar" | "aguardar";
export type Severity = "info" | "atencao" | "critico" | "positivo";

export interface DecisionConfig {
  targetCpa: number;
  maxCpa: number;
  minRoas: number;
  /** Gastou X vezes o CPA alvo sem venda => pausar. */
  killSpendMultiple: number;
  minLinkClicks: number;
  minPurchasesToScale: number;
  connectRateMin: number;
  frequencyMax: number;
  /** Gasto mínimo de teste antes de qualquer veredito (R$). 0 = usa 1,5× CPA alvo. */
  minTestBudget: number;
}

export const DEFAULT_DECISION_CONFIG: DecisionConfig = {
  targetCpa: 60,
  maxCpa: 90,
  minRoas: 1.5,
  killSpendMultiple: 2,
  minLinkClicks: 100,
  minPurchasesToScale: 5,
  connectRateMin: 0.75,
  frequencyMax: 2.5,
  minTestBudget: 0,
};

/** Campos que o usuário pode ajustar por produto (as metas de CPA/ROAS ficam no produto). */
export const RULE_OVERRIDE_KEYS = ["killSpendMultiple", "minLinkClicks", "minPurchasesToScale", "connectRateMin", "frequencyMax", "minTestBudget"] as const;

/** Calcula CPA alvo/máximo a partir do valor líquido por venda e da margem desejada. */
export function configFromProduct(p: {
  netPerSale: number | null;
  targetCpa: number | null;
  maxCpa: number | null;
  minRoas: number | null;
  rules?: Partial<DecisionConfig>;
}): DecisionConfig {
  const net = p.netPerSale ?? null;
  const targetCpa = p.targetCpa ?? (net ? net * 0.5 : DEFAULT_DECISION_CONFIG.targetCpa);
  const maxCpa = p.maxCpa ?? (net ? net * 0.85 : targetCpa * 1.5);
  const minRoas = p.minRoas ?? (net && maxCpa ? net / maxCpa : DEFAULT_DECISION_CONFIG.minRoas);
  const overrides: Partial<DecisionConfig> = {};
  for (const k of RULE_OVERRIDE_KEYS) {
    const v = p.rules?.[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) overrides[k] = v;
  }
  return { ...DEFAULT_DECISION_CONFIG, ...overrides, targetCpa, maxCpa, minRoas };
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
  /** Vendas pagas confirmadas na Cakto e atribuídas a esta entidade. */
  realPurchases: number;
  realNetRevenue: number;
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
}

export interface DecisionResult {
  status: DecisionStatus;
  confidence: "baixa" | "media" | "alta";
  signals: Signal[];
  /** Quando status = aguardar: quanto falta de dados. */
  missingData: string | null;
  headline: string;
}

export function evaluate(input: DecisionInput): DecisionResult {
  const { config: c } = input;
  const w7 = input.last7d;
  const w3 = input.last3d;
  const signals: Signal[] = [];

  const d7 = deriveMetrics(w7.meta);
  const d3 = deriveMetrics(w3.meta);
  const purchases7 = w7.realPurchases;
  const purchases3 = w3.realPurchases;
  const cpa7 = safeDiv(w7.meta.spend, purchases7);
  const cpa3 = safeDiv(w3.meta.spend, purchases3);
  const roas7 = safeDiv(w7.realNetRevenue, w7.meta.spend);

  if (!input.trackingOk) {
    signals.push({
      code: "tracking_quebrado",
      severity: "critico",
      message: "Tracking não confiável: recomendação sem dado confiável é pior que nenhuma. Corrija as conexões primeiro.",
      evidence: {},
    });
  }

  // ---- Regra de kill: gastou X× o CPA alvo sem nenhuma venda ----
  const killThreshold = c.targetCpa * c.killSpendMultiple;
  if (purchases7 === 0 && w7.meta.spend >= killThreshold) {
    signals.push({
      code: "gasto_sem_venda",
      severity: "critico",
      message: `Gastou ${fmtBRL(w7.meta.spend)} em 7 dias sem venda (limite: ${c.killSpendMultiple}× CPA alvo = ${fmtBRL(killThreshold)}).`,
      evidence: { spend7d: w7.meta.spend, killThreshold, purchases7d: 0 },
    });
  }

  // ---- Connect rate ----
  if (d7.connectRate != null && w7.meta.linkClicks >= 50 && d7.connectRate < c.connectRateMin) {
    signals.push({
      code: "connect_rate_baixo",
      severity: d7.connectRate < 0.6 ? "critico" : "atencao",
      message: `Connect rate ${fmtPct(d7.connectRate, 0)} < ${fmtPct(c.connectRateMin, 0)}: cliques se perdem antes da página carregar.`,
      evidence: { connectRate: d7.connectRate, linkClicks: w7.meta.linkClicks, lpv: w7.meta.landingPageViews },
    });
  }

  // ---- Frequência ----
  if (d3.frequency != null && d3.frequency > c.frequencyMax) {
    signals.push({
      code: "frequencia_alta",
      severity: "atencao",
      message: `Frequência ${fmtDec(d3.frequency, 1)} > ${fmtDec(c.frequencyMax, 1)} nos últimos 3 dias: risco de saturação/fadiga.`,
      evidence: { frequency3d: d3.frequency },
    });
  }

  // ---- CTR ----
  if (d7.ctrLink != null && w7.meta.impressions >= 3000 && d7.ctrLink < 0.008) {
    signals.push({
      code: "ctr_baixo",
      severity: "atencao",
      message: `CTR de link ${fmtPct(d7.ctrLink, 2)} abaixo de 0,8%: gancho/criativo não está gerando clique.`,
      evidence: { ctrLink: d7.ctrLink, impressions: w7.meta.impressions },
    });
  }

  // ---- Hook rate ----
  if (d7.hookRate != null && w7.meta.video3s > 0 && w7.meta.impressions >= 3000 && d7.hookRate < 0.2) {
    signals.push({
      code: "hook_baixo",
      severity: "atencao",
      message: `Hook rate ${fmtPct(d7.hookRate, 0)} < 20%: os 3 primeiros segundos não param a rolagem.`,
      evidence: { hookRate: d7.hookRate },
    });
  }

  // ---- Checkout / página ----
  if (d7.checkoutRate != null && w7.meta.landingPageViews >= 150 && d7.checkoutRate < 0.05) {
    signals.push({
      code: "pagina_nao_converte",
      severity: "atencao",
      message: `Só ${fmtPct(d7.checkoutRate, 1)} das visitas iniciam checkout: página/oferta não convence.`,
      evidence: { checkoutRate: d7.checkoutRate, lpv: w7.meta.landingPageViews },
    });
  }

  // ---- CPA vs meta ----
  if (cpa3 != null && purchases3 >= 2 && cpa3 > c.maxCpa) {
    signals.push({
      code: "cpa_acima_max",
      severity: "critico",
      message: `CPA real 3d ${fmtBRL(cpa3)} = ${fmtDec(cpa3 / c.targetCpa, 1)}× a meta (máx. tolerável ${fmtBRL(c.maxCpa)}).`,
      evidence: { cpa3d: cpa3, targetCpa: c.targetCpa, maxCpa: c.maxCpa },
    });
  } else if (cpa7 != null && purchases7 >= 3 && cpa7 > c.targetCpa) {
    signals.push({
      code: "cpa_acima_alvo",
      severity: "atencao",
      message: `CPA real 7d ${fmtBRL(cpa7)} acima do alvo ${fmtBRL(c.targetCpa)}.`,
      evidence: { cpa7d: cpa7, targetCpa: c.targetCpa },
    });
  } else if (cpa7 != null && purchases7 >= c.minPurchasesToScale && cpa7 <= c.targetCpa) {
    signals.push({
      code: "cpa_saudavel",
      severity: "positivo",
      message: `CPA real 7d ${fmtBRL(cpa7)} dentro do alvo (${fmtBRL(c.targetCpa)}) com ${purchases7} vendas.`,
      evidence: { cpa7d: cpa7, purchases7d: purchases7 },
    });
  }

  if (cpa7 != null && purchases7 > 0 && purchases7 < 3 && cpa7 > c.maxCpa) {
    signals.push({
      code: "cpa_alto_pouco_volume",
      severity: "atencao",
      message: `Só ${purchases7} venda(s) em 7 dias com CPA ${fmtBRL(cpa7)} (máx. ${fmtBRL(c.maxCpa)}): ainda pouco volume, mas a tendência é ruim.`,
      evidence: { cpa7d: cpa7, purchases7d: purchases7, maxCpa: c.maxCpa },
    });
  }

  if (roas7 != null && purchases7 >= 3 && roas7 < c.minRoas) {
    signals.push({
      code: "roas_abaixo_min",
      severity: "atencao",
      message: `ROAS real 7d ${fmtDec(roas7, 2)}x abaixo do mínimo ${fmtDec(c.minRoas, 2)}x.`,
      evidence: { roas7d: roas7, minRoas: c.minRoas },
    });
  }

  // ---- Saturação de público: CPM subindo + frequência alta + alcance novo caindo ----
  if (input.prev4d && input.prev4d.meta.impressions > 2000 && w3.meta.impressions > 1500) {
    const dp = deriveMetrics(input.prev4d.meta);
    const cpmUp = dp.cpm && d3.cpm ? (d3.cpm - dp.cpm) / dp.cpm : null;
    // alcance por real gasto: quanto de gente nova cada R$ compra
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

  // ---- Fadiga de criativos ----
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
    signals.push({
      code: "fase_aprendizado",
      severity: "info",
      message: "Em fase de aprendizado: evite edições significativas (orçamento > 20%, público, criativo).",
      evidence: {},
    });
  }

  // ---------------- Status ----------------
  // Pausar: gasto sem venda, ou CPA acima do máximo tolerável sustentado (3 E 7 dias).
  // CPA alto só nos últimos 3 dias => Otimizar (pode ser oscilação).
  const sustainedHighCpa = signals.some((s) => s.code === "cpa_acima_max") && cpa7 != null && cpa7 > c.maxCpa;
  const hasKill = signals.some((s) => s.code === "gasto_sem_venda") || sustainedHighCpa;
  const criticalTracking = !input.trackingOk;

  // Volume estatístico mínimo
  const needClicks = Math.max(0, c.minLinkClicks - w7.meta.linkClicks);
  const spendForVerdict = Math.max(c.minTestBudget, c.targetCpa * 1.5);
  const insufficient = purchases7 < 3 && w7.meta.linkClicks < c.minLinkClicks && w7.meta.spend < spendForVerdict;

  let status: DecisionStatus;
  let missingData: string | null = null;
  let confidence: DecisionResult["confidence"] = "media";

  if (hasKill) {
    status = "pausar";
    confidence = purchases7 === 0 && w7.meta.spend >= killThreshold * 1.5 ? "alta" : "media";
  } else if (insufficient) {
    status = "aguardar";
    confidence = "baixa";
    const spendLeft = Math.max(0, spendForVerdict - w7.meta.spend);
    missingData = `Faltam ~${needClicks} cliques no link ou ~${fmtBRL(spendLeft)} de gasto (ou 3 vendas) para um veredito.`;
  } else if (
    cpa7 != null &&
    purchases7 >= c.minPurchasesToScale &&
    cpa7 <= c.targetCpa &&
    (cpa3 == null || cpa3 <= c.targetCpa * 1.1) &&
    !signals.some((s) => s.severity === "critico")
  ) {
    status = "escalar";
    confidence = purchases7 >= 15 ? "alta" : "media";
  } else if (signals.some((s) => s.severity === "critico" || s.severity === "atencao")) {
    status = "otimizar";
  } else {
    status = "manter";
  }

  if (criticalTracking && status === "escalar") {
    status = "manter";
    confidence = "baixa";
  }
  if (criticalTracking) confidence = "baixa";

  return { status, confidence, signals, missingData, headline: headlineFor(status, signals, missingData) };
}

function headlineFor(status: DecisionStatus, signals: Signal[], missing: string | null): string {
  const top = signals.find((s) => s.severity === "critico") ?? signals.find((s) => s.severity === "atencao");
  switch (status) {
    case "pausar":
      return top?.message ?? "Resultado abaixo do tolerável.";
    case "aguardar":
      return missing ?? "Dados insuficientes.";
    case "escalar":
      return signals.find((s) => s.severity === "positivo")?.message ?? "Performance dentro da meta com volume.";
    case "otimizar":
      return top?.message ?? "Há pontos de melhoria.";
    default:
      return "Dentro do esperado. Mantenha e acompanhe.";
  }
}

export const STATUS_LABEL: Record<DecisionStatus, string> = {
  escalar: "Escalar",
  manter: "Manter",
  otimizar: "Otimizar",
  pausar: "Pausar",
  aguardar: "Aguardar dados",
};
