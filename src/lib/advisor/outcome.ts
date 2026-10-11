import type { DecisionStatus } from "@/lib/decision/rules";
import { compareRates, cpaInterval, wilson } from "@/lib/stats/core";
import { fmtBRL } from "@/lib/format";
import { addDays } from "@/lib/tz";
import { safeDiv } from "@/lib/utils";

/**
 * "Parecer vs. resultado": compara o que cada parecer disse com o que aconteceu
 * nos dias seguintes. Só usa números já medidos (gasto do Meta + compras
 * principais pagas com origem na campanha). "Acertou"/"errou" só quando o
 * intervalo de 95% do CPA depois do parecer fica inteiro de um lado do CPA
 * máximo — senão é "inconclusivo".
 */

export interface OutcomeDay {
  date: string;
  spend: number;
  /** Compras principais pagas com origem na campanha. */
  purchases: number;
  /** Faturamento bruto aprovado (data de pagamento). */
  revenue: number;
}

export interface OutcomeWindow {
  from: string;
  to: string;
  days: number;
  spend: number;
  purchases: number;
  revenue: number;
  spendPerDay: number | null;
  cpa: number | null;
  cpaLower: number | null;
  cpaUpper: number | null;
  roas: number | null;
}

/** Economia observada DEPOIS do parecer. */
export type OutcomeEvidence = "lucrativo" | "deficitario" | "inconclusivo" | "sem_gasto";

export type OutcomeVerdict = "acertou" | "errou" | "inconclusivo" | "nao_avaliavel" | "aguardando";

export type Followed = "sim" | "parcial" | "nao";

export interface OutcomeTargets {
  /** CPA máximo (equilíbrio) usado para julgar. */
  maxCpa: number;
  /** Sensibilidade do corte por falta de venda (k: chance de 0 vendas < e^-k). */
  killSpendMultiple: number;
  /** De onde veio a meta: gravada no parecer ou a meta atual do produto. */
  source: "parecer" | "atual";
}

export interface ReportOutcome {
  reportId: string;
  campaignId: string;
  reportDate: string;
  status: DecisionStatus;
  rulesStatus: DecisionStatus | null;
  targets: OutcomeTargets;
  before: OutcomeWindow;
  after: OutcomeWindow;
  /** Dias completos já observados depois do parecer (hoje não conta). */
  daysObserved: number;
  minDays: number;
  ready: boolean;
  evidence: OutcomeEvidence | null;
  evidenceNote: string;
  consultant: OutcomeVerdict;
  rules: OutcomeVerdict | null;
  /** Se a recomendação parece ter sido seguida (só pelo gasto/dia). */
  followed: Followed | null;
  followedNote: string | null;
  /** Compras por real gasto: depois vs. antes (teste exato). */
  trend: { direction: "melhorou" | "piorou" | "estavel"; pValue: number } | null;
}

export const OUTCOME_VERDICT_LABEL: Record<OutcomeVerdict, string> = {
  acertou: "Acertou",
  errou: "Errou",
  inconclusivo: "Inconclusivo",
  nao_avaliavel: "Não avaliável",
  aguardando: "Aguardando dados",
};

export const EVIDENCE_LABEL: Record<OutcomeEvidence, string> = {
  lucrativo: "Lucrativo",
  deficitario: "Deficitário",
  inconclusivo: "Inconclusivo",
  sem_gasto: "Sem gasto",
};

const r2 = (v: number) => Math.round(v * 100) / 100;

function windowOf(days: OutcomeDay[], from: string, to: string): OutcomeWindow {
  const rows = to < from ? [] : days.filter((d) => d.date >= from && d.date <= to);
  const n = to < from ? 0 : Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const spend = r2(rows.reduce((s, d) => s + d.spend, 0));
  const purchases = rows.reduce((s, d) => s + d.purchases, 0);
  const revenue = r2(rows.reduce((s, d) => s + d.revenue, 0));
  const ci = cpaInterval(spend, purchases);
  return {
    from,
    to,
    days: n,
    spend,
    purchases,
    revenue,
    spendPerDay: n > 0 ? r2(spend / n) : null,
    cpa: ci.point,
    cpaLower: ci.lower,
    cpaUpper: ci.upper,
    roas: safeDiv(revenue, spend),
  };
}

/** Gasto mínimo para considerar que a campanha continuou rodando. */
function ranOut(after: OutcomeWindow, before: OutcomeWindow): boolean {
  const ref = before.spendPerDay ?? 0;
  return after.spend < 1 || (ref > 0 && (after.spendPerDay ?? 0) < ref * 0.05);
}

export function classifyEvidence(after: OutcomeWindow, before: OutcomeWindow, t: OutcomeTargets): { evidence: OutcomeEvidence; note: string } {
  if (ranOut(after, before)) return { evidence: "sem_gasto", note: "A campanha praticamente não gastou depois do parecer (pausada ou sem entrega)." };
  const max = t.maxCpa;
  if (after.purchases === 0) {
    // Chance de 0 vendas com este gasto se o CPA real fosse o máximo: e^(-gasto/max)
    if (after.spend >= max * t.killSpendMultiple) {
      return { evidence: "deficitario", note: `${fmtBRL(after.spend)} sem nenhuma venda — improvável (<${Math.round(Math.exp(-t.killSpendMultiple) * 100)}%) se o CPA estivesse no máximo de ${fmtBRL(max)}.` };
    }
    return { evidence: "inconclusivo", note: `Nenhuma venda, mas com ${fmtBRL(after.spend)} gastos ainda pode ser azar (CPA máximo ${fmtBRL(max)}).` };
  }
  if (after.cpaUpper != null && after.cpaUpper <= max) {
    return { evidence: "lucrativo", note: `CPA de ${fmtBRL(after.cpa!)} (95%: até ${fmtBRL(after.cpaUpper)}) abaixo do máximo de ${fmtBRL(max)}.` };
  }
  if (after.cpaLower != null && after.cpaLower > max) {
    return { evidence: "deficitario", note: `CPA de ${fmtBRL(after.cpa!)} (95%: pelo menos ${fmtBRL(after.cpaLower)}) acima do máximo de ${fmtBRL(max)}.` };
  }
  const side = (after.cpa ?? Infinity) <= max ? "abaixo" : "acima";
  return { evidence: "inconclusivo", note: `CPA de ${fmtBRL(after.cpa!)} ${side} do máximo de ${fmtBRL(max)}, mas com ${after.purchases} venda(s) o intervalo de 95% ainda cruza o máximo.` };
}

/** O veredito, olhando para trás, se confirmou? */
export function judge(status: DecisionStatus, evidence: OutcomeEvidence): OutcomeVerdict {
  if (status === "otimizar" || status === "aguardar") return "nao_avaliavel";
  if (evidence === "sem_gasto") return "nao_avaliavel";
  if (evidence === "inconclusivo") return "inconclusivo";
  const positive = status === "escalar" || status === "manter";
  if (positive) return evidence === "lucrativo" ? "acertou" : "errou";
  return evidence === "deficitario" ? "acertou" : "errou"; // pausar
}

function followedOf(status: DecisionStatus, before: OutcomeWindow, after: OutcomeWindow): { followed: Followed | null; note: string | null } {
  const b = before.spendPerDay ?? 0;
  const a = after.spendPerDay ?? 0;
  if (status === "pausar") {
    if (ranOut(after, before)) return { followed: "sim", note: "A campanha parou de gastar depois do parecer." };
    if (b > 0 && a <= b * 0.5) return { followed: "parcial", note: `Gasto/dia caiu de ${fmtBRL(b)} para ${fmtBRL(a)}, mas a campanha seguiu rodando.` };
    return { followed: "nao", note: "A campanha continuou gastando no mesmo ritmo." };
  }
  if (b <= 0) return { followed: null, note: null };
  const ratio = a / b;
  const pctTxt = `${ratio >= 1 ? "+" : ""}${Math.round((ratio - 1) * 100)}%`;
  if (status === "escalar") {
    if (ratio >= 1.15) return { followed: "sim", note: `Gasto/dia subiu ${pctTxt} (${fmtBRL(b)} → ${fmtBRL(a)}).` };
    return { followed: "nao", note: `Gasto/dia não subiu (${pctTxt}): o orçamento parece não ter sido aumentado.` };
  }
  if (status === "manter") {
    if (ratio >= 0.75 && ratio <= 1.25) return { followed: "sim", note: `Gasto/dia estável (${pctTxt}).` };
    return { followed: "nao", note: `Gasto/dia mudou ${pctTxt}: o orçamento foi alterado.` };
  }
  return { followed: null, note: null };
}

/**
 * Avalia um parecer. `days` = série diária da campanha (deve cobrir de
 * reportDate-6 até ontem); `today` = hoje no fuso da conta.
 */
export function evaluateOutcome(
  report: { id: string; campaignId: string; reportDate: string; status: DecisionStatus; rulesStatus: DecisionStatus | null },
  days: OutcomeDay[],
  targets: OutcomeTargets,
  today: string,
  opts: { windowDays?: number; minDays?: number } = {},
): ReportOutcome {
  const windowDays = opts.windowDays ?? 7;
  const minDays = opts.minDays ?? 3;
  const before = windowOf(days, addDays(report.reportDate, -6), report.reportDate);
  const lastFull = addDays(today, -1);
  const afterTo = addDays(report.reportDate, windowDays) < lastFull ? addDays(report.reportDate, windowDays) : lastFull;
  const after = windowOf(days, addDays(report.reportDate, 1), afterTo);
  const daysObserved = after.days;
  const ready = daysObserved >= minDays;

  const base = { reportId: report.id, campaignId: report.campaignId, reportDate: report.reportDate, status: report.status, rulesStatus: report.rulesStatus, targets, before, after, daysObserved, minDays, ready };
  if (!ready) {
    return {
      ...base,
      evidence: null,
      evidenceNote: `Faltam ${minDays - daysObserved} dia(s) completo(s) depois do parecer para comparar (mínimo ${minDays}).`,
      consultant: "aguardando",
      rules: report.rulesStatus ? "aguardando" : null,
      followed: null,
      followedNote: null,
      trend: null,
    };
  }

  const { evidence, note } = classifyEvidence(after, before, targets);
  const f = followedOf(report.status, before, after);
  let trend: ReportOutcome["trend"] = null;
  if (before.spend > 0 && after.spend > 0 && before.purchases + after.purchases > 0) {
    const c = compareRates(after.purchases, after.spend, before.purchases, before.spend);
    trend = { direction: c.pValue < 0.05 && c.better != null ? (c.better ? "melhorou" : "piorou") : "estavel", pValue: c.pValue };
  }
  return {
    ...base,
    evidence,
    evidenceNote: note,
    consultant: judge(report.status, evidence),
    rules: report.rulesStatus ? judge(report.rulesStatus, evidence) : null,
    followed: f.followed,
    followedNote: f.note,
    trend,
  };
}

// ------------------------------- Placar -------------------------------

export interface Scoreboard {
  acertos: number;
  erros: number;
  inconclusivos: number;
  naoAvaliaveis: number;
  aguardando: number;
  /** Acertos / (acertos + erros); null sem casos decididos. */
  rate: number | null;
  /** IC 95% (Wilson) da taxa de acerto. */
  rateLower: number | null;
  rateUpper: number | null;
}

export interface AccuracySummary {
  /** Pareceres considerados (1 por campanha por dia: o mais recente). */
  total: number;
  consultant: Scoreboard;
  rules: Scoreboard;
  byStatus: Array<{ status: DecisionStatus; board: Scoreboard }>;
  /** Consultor e regras discordaram e o resultado decidiu. */
  disagreements: { consultantRight: number; rulesRight: number; undecided: number };
}

function board(verdicts: OutcomeVerdict[]): Scoreboard {
  const count = (v: OutcomeVerdict) => verdicts.filter((x) => x === v).length;
  const acertos = count("acertou");
  const erros = count("errou");
  const w = wilson(acertos, acertos + erros);
  return {
    acertos,
    erros,
    inconclusivos: count("inconclusivo"),
    naoAvaliaveis: count("nao_avaliavel"),
    aguardando: count("aguardando"),
    rate: w?.p ?? null,
    rateLower: w?.lower ?? null,
    rateUpper: w?.upper ?? null,
  };
}

/**
 * Mantém só o parecer mais recente de cada campanha em cada dia (vários
 * pareceres no mesmo dia olham para os mesmos dias seguintes).
 * Espera a lista ordenada do mais novo para o mais antigo.
 */
export function dedupeByDay<T extends { campaignId: string; reportDate: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((o) => {
    const key = `${o.campaignId}|${o.reportDate}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function accuracySummary(outcomes: ReportOutcome[]): AccuracySummary {
  const list = dedupeByDay(outcomes);
  const statuses: DecisionStatus[] = ["escalar", "manter", "otimizar", "pausar", "aguardar"];
  const withRules = list.filter((o) => o.rules != null);
  const dis = { consultantRight: 0, rulesRight: 0, undecided: 0 };
  for (const o of withRules) {
    if (o.rulesStatus === o.status) continue;
    if (o.consultant === "acertou" && o.rules !== "acertou") dis.consultantRight++;
    else if (o.rules === "acertou" && o.consultant !== "acertou") dis.rulesRight++;
    else dis.undecided++;
  }
  return {
    total: list.length,
    consultant: board(list.map((o) => o.consultant)),
    rules: board(withRules.map((o) => o.rules!)),
    byStatus: statuses
      .map((status) => ({ status, board: board(withRules.filter((o) => o.rulesStatus === status).map((o) => o.rules!)) }))
      .filter((x) => x.board.acertos + x.board.erros + x.board.inconclusivos + x.board.naoAvaliaveis + x.board.aguardando > 0),
    disagreements: dis,
  };
}
