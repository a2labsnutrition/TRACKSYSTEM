import { fmtBRL, fmtPct } from "@/lib/format";
import { deriveMetrics, type DerivedMetrics, type FatigueSignal, type MetaTotals } from "@/lib/metrics/compute";
import { compareRates, cpaInterval, probZeroPurchases, wilson } from "@/lib/stats/core";
import { safeDiv } from "@/lib/utils";

/**
 * Inteligência de criativos.
 *
 * Princípio central: o Meta distribui o orçamento pela PREVISÃO do leilão.
 * Um criativo receber mais verba não prova que ele vende mais — e uma venda
 * sem origem nunca é atribuída ao criativo que gastou mais.
 * "Vencedor" só com teste estatístico contra o restante da campanha,
 * robusto às vendas sem origem (que podem ter vindo de qualquer criativo).
 */

export type CreativeVerdict = "destaque_comprovado" | "sinal_positivo" | "abaixo_comprovado" | "gasto_sem_venda" | "inconclusivo" | "pouco_gasto";

export const VERDICT_LABEL: Record<CreativeVerdict, string> = {
  destaque_comprovado: "Destaque comprovado",
  sinal_positivo: "Sinal positivo (não comprovado)",
  abaixo_comprovado: "Abaixo do restante (comprovado)",
  gasto_sem_venda: "Gasto sem venda",
  inconclusivo: "Inconclusivo",
  pouco_gasto: "Pouco gasto para avaliar",
};

export interface CreativeInput {
  id: string;
  name: string;
  status: string;
  meta: MetaTotals;
  /** Compras principais com origem neste anúncio (confirmada + provável). */
  purchases: number;
  confirmed: number;
  /** Faturamento bruto das compras atribuídas. */
  revenue: number;
  fatigue: FatigueSignal | null;
}

export interface CreativeAnalysis extends CreativeInput {
  derived: DerivedMetrics;
  /** Retenção do vídeo relativa às visualizações de 3s (null sem vídeo). */
  retention: { p25: number | null; p50: number | null; p75: number | null; p100: number | null } | null;
  spendShare: number | null;
  purchaseShare: number | null;
  cpa: number | null;
  cpaLower: number | null;
  cpaUpper: number | null;
  roas: number | null;
  /** Comparação da taxa de compra por R$ contra o restante da campanha. */
  vsRest: { pValue: number; ratio: number | null } | null;
  /** CTR de link comparado ao restante (intervalos de Wilson que não se sobrepõem). */
  ctrVsRest: "maior" | "menor" | "sem_diferenca" | null;
  verdict: CreativeVerdict;
  reasons: string[];
  distributionNote: string | null;
}

export interface CreativeTest {
  title: string;
  detail: string;
}

export interface CreativeReport {
  ads: CreativeAnalysis[];
  notes: string[];
  tests: CreativeTest[];
  method: string;
}

export const CREATIVE_METHOD =
  "Cada criativo é comparado ao RESTANTE da campanha pela taxa de compras por real gasto (teste exato condicional, Poisson). " +
  "“Comprovado” exige p < 0,05 mesmo se todas as vendas sem origem fossem do outro lado. CTR é comparado por intervalos de Wilson (95%). " +
  "Gasto alto indica a previsão do algoritmo do Meta, não desempenho comprovado.";

export function analyzeCreatives(inputs: CreativeInput[], opts: { maxCpa: number; unattributed: number }): CreativeReport {
  const withSpend = inputs.filter((a) => a.meta.spend > 0);
  const S = withSpend.reduce((s, a) => s + a.meta.spend, 0);
  const K = withSpend.reduce((s, a) => s + a.purchases, 0);
  const I = withSpend.reduce((s, a) => s + a.meta.impressions, 0);
  const C = withSpend.reduce((s, a) => s + a.meta.linkClicks, 0);
  const pool = Math.max(0, opts.unattributed);
  const maxCpa = opts.maxCpa > 0 ? opts.maxCpa : 1;
  const topSpendId = [...withSpend].sort((a, b) => b.meta.spend - a.meta.spend)[0]?.id ?? null;

  const ads: CreativeAnalysis[] = inputs.map((a) => {
    const derived = deriveMetrics(a.meta);
    const spend = a.meta.spend;
    const restS = S - spend;
    const restK = K - a.purchases;
    const ci = cpaInterval(spend, a.purchases);
    const reasons: string[] = [];

    let vsRest: CreativeAnalysis["vsRest"] = null;
    let provedBetter = false;
    let provedWorse = false;
    if (spend > 0 && restS > 0 && K + pool > 0) {
      const r = compareRates(a.purchases, spend, restK, restS);
      vsRest = { pValue: r.pValue, ratio: r.ratio };
      // robusto às vendas sem origem: o pior cenário para cada conclusão
      if (r.better && r.pValue < 0.05 && a.purchases >= 3) {
        const robust = compareRates(a.purchases, spend, restK + pool, restS);
        provedBetter = robust.better === true && robust.pValue < 0.05;
      }
      if (r.better === false && r.pValue < 0.05) {
        const robust = compareRates(a.purchases + pool, spend, restK, restS);
        provedWorse = robust.better === false && robust.pValue < 0.05;
      }
    }

    let ctrVsRest: CreativeAnalysis["ctrVsRest"] = null;
    const mine = wilson(a.meta.linkClicks, a.meta.impressions);
    const rest = wilson(C - a.meta.linkClicks, I - a.meta.impressions);
    if (mine && rest && a.meta.impressions >= 500 && I - a.meta.impressions >= 500) {
      ctrVsRest = mine.lower > rest.upper ? "maior" : mine.upper < rest.lower ? "menor" : "sem_diferenca";
    }

    const p0 = spend > 0 ? probZeroPurchases(spend, maxCpa) : 1;
    let verdict: CreativeVerdict;
    if (a.purchases === 0 && spend < 0.5 * maxCpa) {
      verdict = "pouco_gasto";
      reasons.push(`${fmtBRL(spend)} gastos — menos da metade do CPA máximo (${fmtBRL(maxCpa)}). Zero venda aqui é esperado.`);
    } else if (a.purchases === 0 && p0 <= 0.05) {
      if (pool > 0) {
        verdict = "inconclusivo";
        reasons.push(`Nenhuma venda identificada com ${fmtBRL(spend)}, mas há ${pool} venda(s) sem origem que podem ter vindo daqui.`);
      } else {
        verdict = "gasto_sem_venda";
        reasons.push(`${fmtBRL(spend)} sem venda: se o CPA real fosse o máximo (${fmtBRL(maxCpa)}), a chance de zero vendas seria ${fmtPct(p0, 1)}.`);
      }
    } else if (provedBetter) {
      verdict = "destaque_comprovado";
      reasons.push(`Vende ${fmtRatio(vsRest?.ratio)} por real gasto que o restante da campanha (p = ${fmtP(vsRest?.pValue)}), mesmo contando as vendas sem origem contra ele.`);
    } else if (provedWorse) {
      verdict = "abaixo_comprovado";
      reasons.push(`Vende menos por real gasto que o restante (p = ${fmtP(vsRest?.pValue)}), mesmo se todas as vendas sem origem fossem dele.`);
    } else if (a.purchases > 0 && (vsRest?.ratio ?? 0) >= 1.3) {
      verdict = "sinal_positivo";
      reasons.push(`${a.purchases} venda(s), taxa ${fmtRatio(vsRest?.ratio)} a do restante — diferença ainda compatível com acaso (p = ${fmtP(vsRest?.pValue)}).`);
    } else {
      verdict = "inconclusivo";
      if (spend > 0) reasons.push(a.purchases > 0 ? `${a.purchases} venda(s): volume insuficiente para separar de acaso.` : "Sem vendas identificadas, mas o gasto ainda é compatível com azar.");
    }
    if (ctrVsRest === "maior") reasons.push(`CTR de link ${fmtPct(derived.ctrLink, 2)} — comprovadamente acima do restante (indicador de atenção, não de venda).`);
    if (ctrVsRest === "menor") reasons.push(`CTR de link ${fmtPct(derived.ctrLink, 2)} — comprovadamente abaixo do restante.`);
    if (a.fatigue?.fatigued && a.fatigue.reason) reasons.push(`Fadiga: ${a.fatigue.reason}.`);

    const spendShare = safeDiv(spend, S);
    let distributionNote: string | null = null;
    if (spendShare != null && spendShare >= 0.4 && withSpend.length >= 2) {
      distributionNote = `O Meta direcionou ${fmtPct(spendShare, 0)} do gasto a este anúncio. Isso reflete a previsão do algoritmo no leilão — não prova que ele vende mais.`;
      if (a.id === topSpendId && pool > 0) distributionNote += ` As ${pool} venda(s) sem origem NÃO foram atribuídas a ele.`;
    }

    const v3 = a.meta.video3s;
    return {
      ...a,
      derived,
      retention:
        v3 > 0
          ? { p25: safeDiv(a.meta.videoP25, v3), p50: safeDiv(a.meta.videoP50, v3), p75: safeDiv(a.meta.videoP75, v3), p100: safeDiv(a.meta.videoP100, v3) }
          : null,
      spendShare,
      purchaseShare: safeDiv(a.purchases, K),
      cpa: ci.point,
      cpaLower: ci.lower,
      cpaUpper: ci.upper,
      roas: safeDiv(a.revenue, spend),
      vsRest,
      ctrVsRest,
      verdict,
      reasons,
      distributionNote,
    };
  });

  const notes: string[] = [];
  if (pool > 0) notes.push(`${pool} venda(s) do período sem origem identificada: não foram distribuídas entre os criativos (nem para o de maior gasto).`);
  const proven = ads.filter((a) => a.verdict === "destaque_comprovado");
  if (!proven.length && withSpend.length >= 2) notes.push("Nenhum criativo se destacou com evidência estatística ainda.");

  const tests: CreativeTest[] = [];
  const perVariant = 3 * maxCpa;
  if (withSpend.length >= 2 && !proven.length) {
    tests.push({
      title: "Teste controlado entre criativos",
      detail:
        `Para comparar sem o viés da distribuição do Meta, dê o MESMO orçamento a cada criativo (um anúncio por conjunto, orçamento no conjunto) ` +
        `ou use o Teste A/B do Gerenciador de Anúncios. Referência: ~${fmtBRL(perVariant)} por criativo (3× o CPA máximo) antes de comparar vendas.`,
    });
  }
  for (const a of ads) {
    if (a.ctrVsRest === "maior" && a.verdict !== "destaque_comprovado" && a.meta.spend > 0) {
      tests.push({
        title: `Variações de “${a.name}”`,
        detail: "Atenção acima da média, vendas ainda inconclusivas: teste 2–3 novas aberturas mantendo a mesma oferta e ângulo (mude uma coisa por vez).",
      });
    }
    if (a.fatigue?.fatigued) {
      tests.push({ title: `Renovar “${a.name}”`, detail: `Sinais de fadiga (${a.fatigue.reason}). Prepare novas aberturas antes de aumentar verba.` });
    }
  }

  return { ads, notes, tests: tests.slice(0, 5), method: CREATIVE_METHOD };
}

function fmtRatio(r: number | null | undefined): string {
  if (r == null || !Number.isFinite(r)) return "—";
  return `${r.toFixed(1).replace(".", ",")}×`;
}

function fmtP(p: number | null | undefined): string {
  if (p == null) return "—";
  return p < 0.001 ? "< 0,001" : p.toFixed(3).replace(".", ",");
}
