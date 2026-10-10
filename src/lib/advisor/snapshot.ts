import type { campaignDetail } from "@/lib/analytics";
import type { AdvisorReport, TrackingHealth } from "@/lib/data/types";
import { deriveMetrics, type MetaTotals } from "@/lib/metrics/compute";
import { addDays } from "@/lib/tz";
import { safeDiv } from "@/lib/utils";

/**
 * "Retrato" da campanha enviado à IA: TODOS os números já calculados pelas
 * funções determinísticas, arredondados e com a unidade no nome do campo.
 * A IA interpreta e recomenda; ela não calcula.
 */

type Detail = NonNullable<Awaited<ReturnType<typeof campaignDetail>>>;

const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 10000) / 100);

function windowSummary(meta: MetaTotals, realPurchases: number, realNet: number) {
  const d = deriveMetrics(meta);
  return {
    gasto_rs: r2(meta.spend),
    impressoes: meta.impressions,
    cliques_link: meta.linkClicks,
    ctr_link_pct: pct(d.ctrLink),
    cpm_rs: r2(d.cpm),
    cpc_link_rs: r2(d.cpcLink),
    frequencia_aprox: r2(d.frequency),
    connect_rate_pct: pct(d.connectRate),
    taxa_checkout_pct: pct(d.checkoutRate),
    taxa_compra_pct: pct(d.purchaseRate),
    hook_rate_pct: pct(d.hookRate),
    hold_rate_pct: pct(d.holdRate),
    compras_meta: meta.purchases,
    vendas_pagas_cakto: realPurchases,
    receita_liquida_rs: r2(realNet),
    cpa_real_rs: r2(safeDiv(meta.spend, realPurchases)),
    roas_real: r2(safeDiv(realNet, meta.spend)),
  };
}

export function buildSnapshot(d: Detail, health: TrackingHealth, previous: AdvisorReport | null, today: string) {
  const { campaign, row, k } = d;
  const c = row.config;
  const budget = campaign.dailyBudget ?? (d.pacing?.dailyBudget || null);
  const w = (x: typeof row.w1) => ({
    gasto_rs: r2(x.spend),
    vendas_pagas_cakto: x.purchases,
    cpa_real_rs: r2(x.cpa),
    roas_real: r2(x.roas),
    ctr_link_pct: pct(x.ctr),
  });

  return {
    data_hoje: today,
    moeda: "BRL",
    fuso: d.ctx.workspace.timezone,
    campanha: {
      nome: campaign.name,
      status: campaign.effectiveStatus,
      objetivo: campaign.objective,
      tipo_orcamento: campaign.budgetType,
      orcamento_diario_rs: r2(budget),
      estrategia_lance: campaign.bidStrategy,
      criada_em: campaign.createdTime?.slice(0, 10) ?? null,
      conjuntos_em_aprendizado: d.adsetPerf.filter((a) => d.adsetMeta.get(a.id)?.learningStage === "LEARNING").map((a) => a.name),
    },
    produto: row.product
      ? { nome: row.product.name, preco_rs: r2(row.product.price), liquido_por_venda_rs: r2(row.product.netPerSale) }
      : null,
    metas: {
      cpa_alvo_rs: r2(c.targetCpa),
      cpa_maximo_rs: r2(c.maxCpa),
      roas_minimo: r2(c.minRoas),
      kill_gasto_sem_venda_rs: r2(c.targetCpa * c.killSpendMultiple),
      frequencia_maxima: c.frequencyMax,
      connect_rate_minimo_pct: pct(c.connectRateMin),
      vendas_minimas_para_escalar: c.minPurchasesToScale,
    },
    sugestoes_orcamento_rs: budget
      ? { atual: r2(budget), mais_20pct: r2(budget * 1.2), mais_30pct: r2(budget * 1.3), menos_20pct: r2(budget * 0.8), menos_50pct: r2(budget * 0.5) }
      : null,
    veredito_regras: {
      status: row.decision.status,
      confianca: row.decision.confidence,
      resumo: row.decision.headline,
      dados_faltando: row.decision.missingData,
      sinais: row.decision.signals.map((s) => ({ codigo: s.code, severidade: s.severity, mensagem: s.message, evidencias: s.evidence })),
    },
    janelas: {
      hoje: w(row.w1),
      ultimos_3_dias: w(row.w3),
      ultimos_7_dias: w(row.w7),
      periodo_selecionado: {
        de: d.timeline[0]?.date ?? null,
        ate: d.timeline.at(-1)?.date ?? null,
        ...windowSummary(k.meta, k.real.paidOrders, k.real.netRevenue),
        lucro_rs: r2(k.profit.profit),
      },
    },
    pacing_hoje: d.pacing
      ? {
          gasto_hoje_rs: r2(d.pacing.spentToday),
          orcamento_diario_rs: r2(d.pacing.dailyBudget),
          pct_do_orcamento: pct(d.pacing.pctOfBudget),
          projecao_fim_do_dia_rs: r2(d.pacing.projectedEndOfDay),
          pct_do_dia_decorrido: pct(d.pacing.dayElapsed),
        }
      : null,
    funil: {
      etapas: d.funnel.map((s) => ({ etapa: s.label, fonte: s.source, quantidade: s.value, passagem_pct: pct(s.rate) })),
      vazamento_principal: d.leak ? { etapa: d.leak.label, passagem_pct: pct(d.leak.rate), referencia_pct: pct(d.leak.bench) } : null,
    },
    serie_diaria: d.timeline
      .filter((p) => p.date >= addDays(today, -13))
      .map((p) => ({
        data: p.date,
        gasto_rs: r2(p.spend),
        vendas: p.purchases,
        cpa_real_rs: r2(p.cpa),
        roas_real: r2(p.roas),
        ctr_link_pct: pct(p.ctr),
        cpm_rs: r2(p.cpm),
        frequencia: r2(p.frequency),
      })),
    conjuntos: d.adsetPerf
      .filter((a) => a.meta.spend > 0)
      .sort((a, b) => b.meta.spend - a.meta.spend)
      .slice(0, 12)
      .map((a) => {
        const m = d.adsetMeta.get(a.id);
        return {
          nome: a.name,
          status: a.status,
          publico: m?.targetingSummary ?? null,
          fase_aprendizado: m?.learningStage ?? null,
          orcamento_diario_rs: r2(m?.dailyBudget),
          gasto_rs: r2(a.meta.spend),
          vendas: a.realPurchases,
          cpa_real_rs: r2(a.cpaReal),
          roas_real: r2(a.roasReal),
          ctr_link_pct: pct(a.derived.ctrLink),
          connect_rate_pct: pct(a.derived.connectRate),
          frequencia: r2(a.derived.frequency),
        };
      }),
    anuncios: d.adPerf
      .filter((a) => a.meta.spend > 0)
      .sort((a, b) => b.meta.spend - a.meta.spend)
      .slice(0, 15)
      .map((a) => ({
        nome: a.name,
        status: a.status,
        formato: a.ad.creative?.format ?? null,
        texto_inicio: a.ad.creative?.body?.split("\n")[0]?.slice(0, 140) ?? null,
        gasto_rs: r2(a.meta.spend),
        vendas: a.realPurchases,
        cpa_real_rs: r2(a.cpaReal),
        roas_real: r2(a.roasReal),
        ctr_link_pct: pct(a.derived.ctrLink),
        hook_rate_pct: pct(a.derived.hookRate),
        hold_rate_pct: pct(a.derived.holdRate),
        fadiga: a.fatigue.fatigued ? a.fatigue.reason : null,
        ranking_qualidade: a.rankings.quality,
      })),
    publicos_destaques: d.highlights,
    eventos_e_acoes_recentes: d.markers.slice(-12).map((m) => ({ data: m.date, tipo: m.kind, descricao: m.label })),
    tracking: {
      integracoes: health.integrations.map((i) => ({ nome: i.label, status: i.status, detalhe: i.detail })),
      vendas_pagas_7d: health.ordersPaid,
      vendas_atribuidas_7d: health.ordersAttributed,
      compras_meta_7d: health.metaPurchases,
    },
    parecer_anterior: previous
      ? {
          data: previous.reportDate,
          veredito: previous.status,
          diagnostico: previous.content.diagnostico,
          plano: previous.content.plano.slice(0, 4).map((p) => `${p.quando}: ${p.acao}`),
        }
      : null,
  };
}

export type Snapshot = ReturnType<typeof buildSnapshot>;
