import type { Ad, AdAccount, AlertSeverity, TrackingHealth } from "@/lib/data/types";
import type { Signal } from "@/lib/decision/rules";
import { fmtBRL, fmtPct } from "@/lib/format";
import { safeDiv } from "@/lib/utils";

/**
 * Motor de alertas (determinístico). Recebe o estado já calculado e devolve
 * candidatos com chave de deduplicação (tipo + entidade): o mesmo problema não
 * gera um alerta novo por hora — ele fica aberto até a condição sumir.
 */

export interface AlertCandidate {
  type: string;
  severity: AlertSeverity;
  entityLevel: "account" | "campaign" | "ad" | "workspace";
  entityId: string | null;
  title: string;
  message: string;
  href: string | null;
  dedupeKey: string;
}

export interface CampaignState {
  id: string;
  name: string;
  active: boolean;
  dailyBudget: number | null;
  spendToday: number;
  spend3d: number;
  signals: Signal[];
}

export interface AlertInput {
  campaigns: CampaignState[];
  ads: Pick<Ad, "id" | "name" | "campaignId" | "effectiveStatus">[];
  accounts: Pick<AdAccount, "id" | "name" | "status">[];
  health: TrackingHealth;
  /** Fração do dia já transcorrida (fuso da conta), 0–1. */
  dayElapsed: number;
  /** Verificações de anomalia (só as com status "anomalia" viram alerta). */
  anomalies?: Array<{ code: string; title: string; status: string; severity: "critico" | "atencao" | "info"; detail: string; href?: string }>;
  /** Radar de Nichos de IA: subnichos em alta na medição mais recente. */
  radarHot?: Array<{ slug: string; name: string; growthPct: number; viewsPerDay: number }>;
}

const SIGNAL_ALERT: Record<string, { type: string; title: string; severity?: AlertSeverity }> = {
  gasto_sem_venda: { type: "gasto_sem_venda", title: "Gasto sem venda" },
  cpa_acima_max: { type: "cpa_acima_meta", title: "CPA acima do máximo" },
  cpa_acima_alvo: { type: "cpa_acima_meta", title: "CPA acima da meta" },
  roas_abaixo_min: { type: "roas_abaixo_min", title: "ROAS abaixo do mínimo" },
  frequencia_alta: { type: "frequencia_alta", title: "Frequência alta" },
  saturacao_publico: { type: "saturacao", title: "Público saturando" },
  criativos_em_fadiga: { type: "fadiga", title: "Criativos em fadiga" },
  connect_rate_baixo: { type: "tracking_divergencia", title: "Cliques sem visualização da página" },
  dados_incompletos: { type: "dados_incompletos", title: "Dados incompletos" },
  vendas_sem_origem: { type: "vendas_sem_origem", title: "Vendas sem origem identificada" },
  sem_margem: { type: "sem_margem", title: "Campanha sem produto (margem desconhecida)" },
};

export function computeAlerts(input: AlertInput): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  const push = (a: Omit<AlertCandidate, "dedupeKey">) => out.push({ ...a, dedupeKey: `${a.type}|${a.entityId ?? "ws"}` });

  for (const c of input.campaigns.filter((x) => x.active)) {
    const href = `/campanhas/${c.id}`;
    for (const s of c.signals) {
      const map = SIGNAL_ALERT[s.code];
      if (!map || s.severity === "info" || s.severity === "positivo") continue;
      // Um alerta de CPA por campanha (o mais grave)
      if (map.type === "cpa_acima_meta" && out.some((o) => o.type === "cpa_acima_meta" && o.entityId === c.id)) continue;
      push({
        type: map.type,
        severity: s.severity === "critico" ? "critico" : "atencao",
        entityLevel: "campaign",
        entityId: c.id,
        title: `${map.title}: ${c.name}`,
        message: s.message,
        href,
      });
    }

    // Queda de entrega: depois do meio do dia, gasto muito abaixo do esperado
    if (c.dailyBudget && input.dayElapsed >= 0.5 && c.spend3d > 0) {
      const expected = c.dailyBudget * input.dayElapsed;
      if (c.spendToday < expected * 0.25) {
        push({
          type: "queda_entrega",
          severity: "atencao",
          entityLevel: "campaign",
          entityId: c.id,
          title: `Queda de entrega: ${c.name}`,
          message: `Gastou ${fmtBRL(c.spendToday)} hoje, esperado ~${fmtBRL(expected)} pelo orçamento de ${fmtBRL(c.dailyBudget)}/dia. Verifique reprovações, limite de gasto da conta ou lance.`,
          href,
        });
      }
    }
  }

  for (const ad of input.ads) {
    if (ad.effectiveStatus === "DISAPPROVED" || ad.effectiveStatus === "WITH_ISSUES") {
      push({
        type: "anuncio_reprovado",
        severity: ad.effectiveStatus === "DISAPPROVED" ? "critico" : "atencao",
        entityLevel: "ad",
        entityId: ad.id,
        title: `${ad.effectiveStatus === "DISAPPROVED" ? "Anúncio reprovado" : "Anúncio com problema"}: ${ad.name}`,
        message: "Veja o motivo no Gerenciador de Anúncios e corrija o texto/criativo (ou peça revisão).",
        href: `/campanhas/${ad.campaignId}`,
      });
    }
  }

  for (const acc of input.accounts) {
    if (acc.status && acc.status !== "Ativa" && acc.status !== "1") {
      push({
        type: "conta_problema",
        severity: "critico",
        entityLevel: "account",
        entityId: acc.id,
        title: `Conta de anúncios com problema: ${acc.name}`,
        message: `Status: ${acc.status}. Os anúncios podem estar parados — verifique pagamento e qualidade da conta.`,
        href: "/conexoes#meta",
      });
    }
  }

  const h = input.health;
  for (const i of h.integrations) {
    if (i.provider === "anthropic") continue;
    if (i.status === "error" || (i.status === "warning" && i.provider !== "meta")) {
      push({
        type: i.provider === "cakto" ? "webhook_parado" : i.provider === "tracking" ? "script_parado" : "meta_erro",
        severity: i.status === "error" ? "critico" : "atencao",
        entityLevel: "workspace",
        entityId: null,
        title: `${i.label}: ${i.status === "error" ? "parado" : "atenção"}`,
        message: i.detail,
        href: "/saude",
      });
    }
    if (i.provider === "meta" && i.expiresAt) {
      const days = (new Date(i.expiresAt).getTime() - Date.now()) / 86400000;
      if (days < 7) {
        push({
          type: "token_expirando",
          severity: days < 2 ? "critico" : "atencao",
          entityLevel: "workspace",
          entityId: null,
          title: "Token do Meta expirando",
          message: `O acesso ao Meta expira em ${Math.max(0, Math.floor(days))} dia(s). Reconecte em Conexões (ou use token de Usuário do Sistema, que não expira).`,
          href: "/conexoes#meta",
        });
      }
    }
  }

  const failRate = safeDiv(h.capiFailed, h.capiSent + h.capiFailed);
  if (failRate != null && failRate > 0.05 && h.capiFailed >= 5) {
    push({
      type: "capi_falhas",
      severity: "atencao",
      entityLevel: "workspace",
      entityId: null,
      title: "Falhas no envio da API de Conversões",
      message: `${fmtPct(failRate, 1)} dos eventos falharam nos últimos 7 dias (${h.capiFailed}). Veja o log em Saúde do tracking.`,
      href: "/saude",
    });
  }

  const attributed = safeDiv(h.ordersAttributed, h.ordersPaid);
  if (attributed != null && h.ordersPaid >= 10 && attributed < 0.6) {
    push({
      type: "atribuicao_baixa",
      severity: "atencao",
      entityLevel: "workspace",
      entityId: null,
      title: "Muitas vendas sem origem",
      message: `Só ${fmtPct(attributed, 0)} das vendas pagas dos últimos 7 dias foram ligadas a um anúncio. Confira o script na página e o parâmetro no checkout.`,
      href: "/saude",
    });
  }

  const order = { critico: 0, atencao: 1, info: 2 };
  // Anomalias (teste estatístico ou regra explícita) — evita repetir o que a saúde das conexões já alertou
  for (const a of input.anomalies ?? []) {
    if (a.status !== "anomalia" || a.severity === "info" || a.code === "capi_falhas") continue;
    if (a.code === "webhook_cakto" && out.some((o) => o.type === "webhook_parado")) continue;
    if (a.code === "sync_meta" && out.some((o) => o.type === "meta_erro")) continue;
    push({ type: `anomalia_${a.code}`, severity: a.severity, entityLevel: "workspace", entityId: null, title: a.title, message: a.detail, href: a.href ?? null });
  }

  // Oportunidade (não problema): fica aberto enquanto o subnicho seguir em alta
  for (const r of input.radarHot ?? []) {
    push({
      type: "radar_em_alta",
      severity: "atencao",
      entityLevel: "workspace",
      entityId: `radar:${r.slug}`,
      title: `Subnicho em alta: ${r.name}`,
      message: `Demanda no YouTube +${Math.round(r.growthPct * 100)}% em 7 dias (${Math.round(r.viewsPerDay).toLocaleString("pt-BR")} views/dia nos vídeos recentes). Bom momento para testar ganchos com a etiqueta ia-${r.slug}.`,
      href: `/radar-ia?s=${r.slug}`,
    });
  }

  return out.sort((a, b) => order[a.severity] - order[b.severity]);
}

export function severityRank(s: AlertSeverity): number {
  return s === "critico" ? 2 : s === "atencao" ? 1 : 0;
}
