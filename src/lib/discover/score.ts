import { diffDays, todayIn } from "@/lib/tz";
import { POLICY_RISK, type Niche } from "./niches";
import type { AdReference, NicheSeed } from "./types";

/**
 * Score de potencial do nicho (0–100) com componentes VISÍVEIS e a origem de cada um.
 *
 *  + Sinais de escala (35%): anúncios no ar há 30+ dias, variações do mesmo criativo,
 *    vários anunciantes no mesmo ângulo — MEDIDO a partir das suas referências
 *    (3+), senão ESTIMATIVA da IA, senão sem dados.
 *  − Saturação (20%): quantos anunciantes disputam o nicho — medido com 5+ referências,
 *    senão estimativa da IA.
 *  + Ticket (15%) e + Facilidade de produzir (15%): catálogo do sistema.
 *  − Risco de política (15%): catálogo (regras do Meta e, quando cabe, CONAR/ANVISA).
 * Sem dado para um componente, ele fica de fora e o score é marcado como parcial.
 * É um indicador para priorizar o estudo — não uma previsão de vendas.
 */

export type ComponentSource = "medido" | "estimativa_ia" | "catalogo" | "sem_dados";

export interface ScoreComponent {
  key: "escala" | "saturacao" | "ticket" | "facilidade" | "risco";
  label: string;
  /** 0–100 (para saturação e risco, maior = pior). */
  value: number | null;
  weight: number;
  inverse: boolean;
  source: ComponentSource;
  detail: string;
}

export interface NicheScore {
  total: number | null;
  partial: boolean;
  components: ScoreComponent[];
  references: number;
}

export const SOURCE_LABEL: Record<ComponentSource, string> = {
  medido: "medido nas suas referências",
  estimativa_ia: "estimativa da IA",
  catalogo: "catálogo do sistema",
  sem_dados: "sem dados",
};

const clamp = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function daysRunning(ref: Pick<AdReference, "firstSeen">, today = todayIn("America/Sao_Paulo")): number | null {
  if (!ref.firstSeen || !/^\d{4}-\d{2}-\d{2}$/.test(ref.firstSeen)) return null;
  const d = diffDays(ref.firstSeen, today);
  return d >= 0 ? d : null;
}

/** Sinais de escala medidos nas referências. */
export function scalingSignals(refs: AdReference[], today?: string) {
  const days = refs.map((r) => daysRunning(r, today)).filter((d): d is number => d != null);
  const longRunning = days.filter((d) => d >= 30).length;
  const vars = refs.map((r) => r.variations).filter((v): v is number => v != null && v >= 0);
  const avgVariations = vars.length ? vars.reduce((a, b) => a + b, 0) / vars.length : null;
  const byAngle = new Map<string, Set<string>>();
  for (const r of refs) {
    const angle = (r.analysis?.angulo ?? r.angle ?? "").trim().toLowerCase();
    const adv = (r.advertiser ?? "").trim().toLowerCase();
    if (!angle || !adv) continue;
    if (!byAngle.has(angle)) byAngle.set(angle, new Set());
    byAngle.get(angle)!.add(adv);
  }
  const maxAdvertisersPerAngle = Math.max(0, ...[...byAngle.values()].map((x) => x.size));
  const advertisers = new Set(refs.map((r) => (r.advertiser ?? "").trim().toLowerCase()).filter(Boolean)).size;
  return { withDates: days.length, longRunning, longShare: days.length ? longRunning / days.length : null, avgVariations, maxAdvertisersPerAngle, advertisers };
}

function ticketScore(n: Niche): number {
  const avg = (n.ticket.min + n.ticket.max) / 2;
  return clamp(((Math.log(avg) - Math.log(19)) / (Math.log(997) - Math.log(19))) * 100);
}

export function computeNicheScore(niche: Niche, refsAll: AdReference[], seed: NicheSeed | null, today?: string): NicheScore {
  const refs = refsAll.filter((r) => r.nicheSlug === niche.slug);
  const sig = scalingSignals(refs, today);
  const components: ScoreComponent[] = [];

  // + Sinais de escala
  if (refs.length >= 3 && (sig.longShare != null || sig.avgVariations != null || sig.maxAdvertisersPerAngle > 0)) {
    const v = 100 * (0.4 * (sig.longShare ?? 0) + 0.3 * Math.min(sig.avgVariations ?? 0, 10) / 10 + 0.3 * Math.min(sig.maxAdvertisersPerAngle, 5) / 5);
    components.push({
      key: "escala",
      label: "Sinais de anunciantes escalando",
      value: clamp(v),
      weight: 0.35,
      inverse: false,
      source: "medido",
      detail: `${refs.length} referência(s): ${sig.longRunning} no ar há 30+ dias${sig.avgVariations != null ? `, ${sig.avgVariations.toFixed(1).replace(".", ",")} variações em média` : ""}, até ${sig.maxAdvertisersPerAngle} anunciante(s) no mesmo ângulo.`,
    });
  } else if (seed) {
    components.push({ key: "escala", label: "Sinais de anunciantes escalando", value: clamp(seed.escala_estimada), weight: 0.35, inverse: false, source: "estimativa_ia", detail: `${seed.justificativa} (importe 3+ referências para medir)` });
  } else {
    components.push({ key: "escala", label: "Sinais de anunciantes escalando", value: null, weight: 0.35, inverse: false, source: "sem_dados", detail: `Importe 3+ referências do nicho (tem ${refs.length}) ou gere a estimativa da IA.` });
  }

  // − Saturação
  if (refs.length >= 5) {
    components.push({
      key: "saturacao",
      label: "Saturação",
      value: clamp((sig.advertisers / 15) * 100),
      weight: 0.2,
      inverse: true,
      source: "medido",
      detail: `${sig.advertisers} anunciante(s) diferente(s) nas suas ${refs.length} referências (15+ = saturado). Amostra limitada ao que você importou.`,
    });
  } else if (seed) {
    components.push({ key: "saturacao", label: "Saturação", value: clamp(seed.saturacao_estimada), weight: 0.2, inverse: true, source: "estimativa_ia", detail: "Estimativa da IA (importe 5+ referências para medir)." });
  } else {
    components.push({ key: "saturacao", label: "Saturação", value: null, weight: 0.2, inverse: true, source: "sem_dados", detail: "Precisa de 5+ referências ou da estimativa da IA." });
  }

  components.push({
    key: "ticket",
    label: "Ticket típico",
    value: ticketScore(niche),
    weight: 0.15,
    inverse: false,
    source: "catalogo",
    detail: `Faixa comum R$ ${niche.ticket.min} a R$ ${niche.ticket.max}. Ticket maior aguenta CPA maior no tráfego pago.`,
  });
  components.push({ key: "facilidade", label: "Facilidade de produzir", value: niche.ease, weight: 0.15, inverse: false, source: "catalogo", detail: "Referência do sistema para criar o produto (conteúdo, prova, formato)." });
  components.push({
    key: "risco",
    label: "Risco de política do Meta",
    value: POLICY_RISK[niche.policy.level],
    weight: 0.15,
    inverse: true,
    source: "catalogo",
    detail: niche.policy.reasons.length ? niche.policy.reasons.join(" ") : "Sem restrições específicas conhecidas para o tema.",
  });

  const used = components.filter((c) => c.value != null);
  const wsum = used.reduce((a, c) => a + c.weight, 0);
  const total = wsum ? clamp(used.reduce((a, c) => a + c.weight * (c.inverse ? 100 - c.value! : c.value!), 0) / wsum) : null;
  return { total, partial: used.length < components.length, components, references: refs.length };
}
