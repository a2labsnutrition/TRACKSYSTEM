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

function windowSummary(meta: MetaTotals, mainPurchases: number, grossRevenue: number) {
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
    custo_por_checkout_rs: r2(d.costPerCheckout),
    compras_meta: meta.purchases,
    compras_principais_pagas_cakto: mainPurchases,
    faturamento_bruto_rs: r2(grossRevenue),
    cpa_rs: r2(safeDiv(meta.spend, mainPurchases)),
    roas_bruto: r2(safeDiv(grossRevenue, meta.spend)),
  };
}

export function buildSnapshot(d: Detail, health: TrackingHealth, previous: AdvisorReport | null, today: string) {
  const { campaign, row, k } = d;
  const c = row.config;
  const budget = campaign.dailyBudget ?? (d.pacing?.dailyBudget || null);
  const w = (x: typeof row.w1) => ({
    gasto_rs: r2(x.spend),
    compras_principais_com_origem: x.purchases,
    cpa_rs: r2(x.cpa),
    roas_bruto: r2(x.roas),
    ctr_link_pct: pct(x.ctr),
  });
  const dec = row.decision;
  const fin = k.fin;

  return {
    data_hoje: today,
    moeda: "BRL",
    fuso_da_conta: d.timezone,
    cambio: k.fx.estimated || k.fx.missing
      ? {
          moedas_da_conta: k.fx.currencies,
          gasto_convertido_estimado: k.fx.estimated,
          gasto_sem_cotacao_excluido: k.fx.missing,
          observacao: "Gasto convertido para R$ com cotação + IOF/spread estimados; valores em R$ são aproximados.",
        }
      : null,
    campanha: {
      nome: campaign.name,
      status: campaign.effectiveStatus,
      objetivo: campaign.objective,
      tipo_orcamento: campaign.budgetType,
      orcamento_diario_rs: r2(budget),
      estrategia_lance: campaign.bidStrategy,
      criada_em: campaign.createdTime?.slice(0, 10) ?? null,
      dias_com_gasto_ultimos_7: row.daysActive,
      conjuntos_em_aprendizado: d.adsetPerf.filter((a) => d.adsetMeta.get(a.id)?.learningStage === "LEARNING").map((a) => a.name),
    },
    produto: row.product
      ? {
          nome: row.product.name,
          preco_rs: r2(row.product.price),
          liquido_por_venda_rs: r2(row.product.netPerSale),
          custo_por_venda_rs: r2(row.product.costPerSale ?? 0),
          custo_pct_faturamento: pct(row.product.costPct ?? 0),
        }
      : null,
    metas: {
      cpa_maximo_rs: r2(c.maxCpa),
      origem_cpa_maximo: c.breakevenSource ?? "padrao",
      cpa_equilibrio_rs: r2(c.breakevenCpa ?? null),
      cpa_alvo_rs: r2(c.targetCpa),
      roas_minimo: r2(c.minRoas),
      gasto_sem_venda_para_sinal_forte_rs: r2(c.maxCpa * c.killSpendMultiple),
      frequencia_maxima: c.frequencyMax,
      connect_rate_minimo_pct: pct(c.connectRateMin),
      vendas_minimas_para_escalar: c.minPurchasesToScale,
    },
    veredito_regras: {
      status: dec.status,
      confianca: dec.confidence,
      criterios_confianca: dec.confidenceDetail.criteria.map((x) => ({ criterio: x.label, valor: x.value, nivel: x.level, regra: x.rule })),
      evidencia_economica: dec.evidence,
      cpa_7d_intervalo_95_rs: { ponto: r2(dec.cpa.point), inferior: r2(dec.cpa.lower), superior: r2(dec.cpa.upper), compras: dec.cpa.purchases },
      resumo: dec.headline,
      dados_faltando: dec.missingData,
      sinais: dec.signals.map((s) => ({ codigo: s.code, severidade: s.severity, mensagem: s.message, evidencias: s.evidence })),
      recomendacoes: dec.recommendations.map((r) => ({
        acao: r.action,
        titulo: r.title,
        justificativa: r.justification,
        confianca: r.confidence,
        riscos: r.risks,
        impacto_estimado: r.impact?.text ?? null,
        invalida_se: r.invalidation,
        reavaliar: r.reassess,
      })),
    },
    financeiro_periodo: {
      faturamento_bruto_aprovado_rs: r2(fin.grossApproved),
      produto_principal_rs: r2(fin.mainRevenue),
      order_bumps_rs: r2(fin.bumpRevenue),
      upsells_rs: r2(fin.upsellRevenue),
      reembolsos_rs: r2(fin.refunds),
      taxas_cakto_rs: r2(fin.fees),
      impostos_rs: r2(fin.taxes),
      custos_variaveis_rs: r2(fin.variableCosts),
      gasto_anuncios_rs: r2(fin.adSpend),
      faturamento_menos_trafego_rs: r2(fin.grossMinusAds),
      lucro_de_contribuicao_estimado_rs: r2(fin.contribution),
      margem_de_contribuicao_pct: pct(fin.contributionMargin),
      compras_principais: fin.mainPurchases,
      cpa_rs: r2(fin.cpa),
      roas_bruto: r2(fin.roasGross),
      cpa_equilibrio_medido_rs: r2(fin.breakevenCpa),
      roas_equilibrio: r2(fin.breakevenRoas),
      observacoes: fin.notes,
    },
    atribuicao_periodo: {
      compras_confirmadas: k.attribution.confirmada,
      compras_provaveis: k.attribution.provavel,
      vendas_sem_origem_no_workspace: d.unattributedPool,
      faturamento_sem_origem_no_workspace_rs: r2(d.unattributedRevenue),
      regra: "Vendas sem origem NÃO são atribuídas a nenhuma campanha ou criativo (nem ao de maior gasto).",
    },
    janelas: {
      hoje: w(row.w1),
      ultimos_3_dias: w(row.w3),
      ultimos_7_dias: w(row.w7),
      periodo_selecionado: {
        de: d.timeline[0]?.date ?? null,
        ate: d.timeline.at(-1)?.date ?? null,
        ...windowSummary(k.meta, k.fin.mainPurchases, k.fin.grossApproved),
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
        compras_principais: p.purchases,
        cpa_rs: r2(p.cpa),
        roas_bruto: r2(p.roas),
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
          compras_com_origem: a.realPurchases,
          cpa_rs: r2(a.cpaReal),
          roas_bruto: r2(a.roasReal),
          ctr_link_pct: pct(a.derived.ctrLink),
          connect_rate_pct: pct(a.derived.connectRate),
          frequencia: r2(a.derived.frequency),
        };
      }),
    criativos: {
      metodo: d.creatives.method,
      observacoes: d.creatives.notes,
      testes_sugeridos: d.creatives.tests,
      anuncios: d.creatives.ads
        .filter((a) => a.meta.spend > 0)
        .sort((a, b) => b.meta.spend - a.meta.spend)
        .slice(0, 15)
        .map((a) => {
          const ad = d.adPerf.find((x) => x.id === a.id);
          return {
            nome: a.name,
            status: a.status,
            formato: ad?.ad.creative?.format ?? null,
            texto_inicio: ad?.ad.creative?.body?.split("\n")[0]?.slice(0, 140) ?? null,
            gasto_rs: r2(a.meta.spend),
            parcela_do_gasto_pct: pct(a.spendShare),
            compras_com_origem: a.purchases,
            compras_confirmadas: a.confirmed,
            cpa_rs: r2(a.cpa),
            cpa_intervalo_95_rs: a.purchases > 0 ? [r2(a.cpaLower), r2(a.cpaUpper)] : null,
            roas_bruto: r2(a.roas),
            ctr_link_pct: pct(a.derived.ctrLink),
            cpc_link_rs: r2(a.derived.cpcLink),
            custo_por_checkout_rs: r2(a.derived.costPerCheckout),
            hook_rate_pct: pct(a.derived.hookRate),
            hold_rate_pct: pct(a.derived.holdRate),
            retencao_pct_das_views_3s: a.retention
              ? { p25: pct(a.retention.p25), p50: pct(a.retention.p50), p75: pct(a.retention.p75), p100: pct(a.retention.p100) }
              : null,
            frequencia: r2(a.derived.frequency),
            classificacao: a.verdict,
            motivos: a.reasons,
            nota_distribuicao: a.distributionNote,
            fadiga: a.fatigue?.fatigued ? a.fatigue.reason : null,
            ranking_qualidade: ad?.rankings.quality ?? null,
          };
        }),
    },
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
