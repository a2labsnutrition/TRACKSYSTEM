import "server-only";
import { reportOutcomes } from "@/lib/advisor/outcomes-service";
import { structured } from "@/lib/ai/structured";
import { campaignRows, costSettings, dailySeries } from "@/lib/analytics";
import type { Repository } from "@/lib/data/repository";
import { env } from "@/lib/env";
import { fmtBRL, fmtDec } from "@/lib/format";
import { createSupabaseServer } from "@/lib/supabase/server";
import { addDays, dateIn, resolvePeriod, todayIn } from "@/lib/tz";
import { randomId } from "@/lib/utils";
import { DEFAULT_MONTHLY_GOAL, goalPacing, offerEconomics, type GoalPacing, type OfferEconomics } from "./goal";
import { playbookText } from "./playbook";
import { PlanoSchema, type Plano } from "./schema";

/** Linha reservada em advisor_reports para os planos do Claudinho (não é campanha). */
export const CLAUDINHO_ID = "__claudinho__";

const r2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);
const pct = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 1000) / 10);

export interface ClaudinhoPlan {
  id: string;
  createdAt: string;
  goal: number;
  model: string;
  content: Plano;
}

/** Orçamento na moeda da conta a partir do valor convertido (R$) e da cotação usada nos insights. */
function money(brl: number | null, currency: string, rate: number | null): string | null {
  if (brl == null) return null;
  if (currency === "BRL" || !rate) return `${fmtBRL(brl)}/dia${currency !== "BRL" ? " (moeda da conta: confira no Gerenciador)" : ""}`;
  const sym = currency === "USD" ? "US$" : currency;
  return `${sym} ${fmtDec(brl / rate)}/dia (≈ ${fmtBRL(brl)})`;
}

export async function buildClaudinhoSnapshot(repo: Repository, goal: number) {
  const ctx = await repo.context();
  const tz = ctx.workspace.timezone;
  const today = todayIn(tz);
  const monthStart = `${today.slice(0, 8)}01`;
  const from = monthStart < addDays(today, -7) ? monthStart : addDays(today, -7);
  const p7 = resolvePeriod(tz, "7d");
  const [rows, products, insAll, ordersAll, health, outcomes] = await Promise.all([
    campaignRows(repo, p7),
    repo.products(),
    repo.insights({ level: "campaign", from, to: today }),
    repo.orders({ from: addDays(from, -3), to: today }),
    repo.health(),
    reportOutcomes(repo, { limit: 100 }).catch(() => null),
  ]);
  const costs = costSettings(ctx.workspace, products);

  // Dinheiro líquido por dia (data de pagamento), todas as vendas — com ou sem origem
  const series = dailySeries(insAll, ordersAll, resolvePeriod(tz, "custom", from, today), tz, costs);
  const mtd = series.filter((d) => d.date >= monthStart).reduce((s, d) => s + d.profit, 0);
  const closed7 = series.filter((d) => d.date >= addDays(today, -7) && d.date <= addDays(today, -1));
  const pacing = goalPacing({ goal, today, mtd, last7Closed: closed7.length === 7 ? closed7.reduce((s, d) => s + d.profit, 0) : null });

  // Cotação usada no último insight de cada campanha (para escrever o orçamento na moeda da conta)
  const lastFx = new Map<string, { currency: string; rate: number | null }>();
  for (const r of [...insAll].sort((a, b) => a.date.localeCompare(b.date))) {
    lastFx.set(r.entityId, { currency: (r.currency ?? "BRL").toUpperCase(), rate: r.fxRate ?? null });
  }
  const accCurrency = new Map(ctx.adAccounts.map((a) => [a.id, (a.currency || "BRL").toUpperCase()]));

  const p7from = addDays(today, -6);
  const orders7 = ordersAll.filter((o) => dateIn(new Date(o.paidAt ?? o.createdAt), tz) >= p7from);
  const offers: OfferEconomics[] = offerEconomics({
    products,
    campaigns: rows.map((r) => ({ id: r.campaign.id, productId: r.campaign.productId, active: r.campaign.effectiveStatus === "ACTIVE", spend: r.w7.spend })),
    orders: orders7,
    costs,
    requiredPerDay: pacing.requiredPerDay,
  });

  const campanhas = rows
    .filter((r) => r.campaign.effectiveStatus === "ACTIVE" || r.w7.spend > 0)
    .map((r) => {
      const fx = lastFx.get(r.campaign.id);
      const currency = fx?.currency ?? accCurrency.get(r.campaign.adAccountId) ?? "BRL";
      const w = (x: typeof r.w7) => ({ gasto_rs: r2(x.spend), vendas_com_origem: x.purchases, cpa_rs: r2(x.cpa), roas_bruto: r2(x.roas), ctr_link_pct: pct(x.ctr) });
      return {
        nome: r.campaign.name,
        status: r.campaign.effectiveStatus === "ACTIVE" ? "ativa" : "pausada",
        produto: r.product?.name ?? null,
        tipo_orcamento: r.campaign.budgetType,
        moeda_da_conta: currency,
        orcamento_diario: money(r.campaign.dailyBudget, currency, fx?.rate ?? null),
        orcamento_valor:
          r.campaign.dailyBudget != null && (currency === "BRL" || fx?.rate)
            ? { moeda: currency, valor: r2(currency === "BRL" ? r.campaign.dailyBudget : r.campaign.dailyBudget / fx!.rate!), rs: r2(r.campaign.dailyBudget) }
            : null,
        cpa_maximo_rs: r2(r.config.maxCpa),
        cpa_alvo_rs: r2(r.config.targetCpa),
        hoje: w(r.w1),
        ultimos_3_dias: w(r.w3),
        ultimos_7_dias: w(r.w7),
        dias_com_gasto_7d: r.daysActive,
        lucro_contribuicao_7d_rs: r2(r.period.fin.contribution),
        ticket_medio_rs: r2(r.period.fin.avgOrderValue),
        veredito_regras: {
          status: r.decision.status,
          resumo: r.decision.headline,
          evidencia: r.decision.evidence,
          sinais: r.decision.signals.slice(0, 5).map((s) => s.message),
          recomendacoes: r.decision.recommendations.slice(0, 3).map((x) => `${x.title}: ${x.justification.slice(0, 2).join(" ")}`),
        },
      };
    });

  const fin7 = series.filter((d) => d.date >= p7from);
  const ws7 = {
    gasto_rs: r2(fin7.reduce((s, d) => s + d.spend, 0)),
    faturamento_bruto_rs: r2(fin7.reduce((s, d) => s + d.revenue, 0)),
    liquido_rs: r2(fin7.reduce((s, d) => s + d.profit, 0)),
    vendas_principais: fin7.reduce((s, d) => s + d.purchases, 0),
    compras_que_o_meta_contou: fin7.reduce((s, d) => s + d.metaPurchases, 0),
  };

  return {
    data_hoje: today,
    fuso: tz,
    meta_mensal_liquido_rs: goal,
    ritmo_da_meta: {
      mes: pacing.month,
      liquido_no_mes_rs: pacing.mtd,
      dias_fechados: pacing.daysClosed,
      dias_restantes_contando_hoje: pacing.daysLeft,
      liquido_medio_por_dia_7d_rs: pacing.runRate,
      projecao_fim_do_mes_rs: pacing.projection,
      falta_rs: pacing.remaining,
      liquido_por_dia_necessario_rs: pacing.requiredPerDay,
      status: pacing.status,
    },
    contas_de_anuncio: ctx.adAccounts.map((a) => ({ nome: a.name, moeda: a.currency, fuso: a.timezone })),
    ultimos_7_dias_conta: ws7,
    ofertas_7d: offers.map((o) => ({
      produto: o.productName,
      preco_rs: o.price,
      campanhas: o.campaigns,
      campanhas_ativas: o.activeCampaigns,
      gasto_rs: o.spend,
      clientes_com_origem: o.customers,
      liquido_por_cliente_antes_do_anuncio_rs: o.netPerCustomer,
      ticket_medio_rs: r2(o.avgOrderValue),
      cpa_rs: o.cpa,
      lucro_por_cliente_rs: o.profitPerCustomer,
      lucro_contribuicao_rs: o.contribution,
      vendas_dia_para_bater_a_meta_sozinha: o.salesPerDayForGoal,
      papel_calculado: o.role,
    })),
    campanhas,
    tracking: {
      integracoes: health.integrations.map((i) => `${i.label}: ${i.status} (${i.detail})`),
      vendas_pagas_7d: health.ordersPaid,
      vendas_com_origem_7d: health.ordersAttributed,
      compras_meta_7d: health.metaPurchases,
      regra: "Vendas sem origem não são atribuídas a nenhuma campanha.",
    },
    acerto_dos_pareceres: outcomes
      ? {
          consultor: { acertos: outcomes.summary.consultant.acertos, erros: outcomes.summary.consultant.erros },
          regras: { acertos: outcomes.summary.rules.acertos, erros: outcomes.summary.rules.erros },
        }
      : null,
    preferencias_do_dono: [
      "Não aplicar recomendações automáticas do Meta.",
      "Orçamento na campanha (CBO), nunca no anúncio.",
      "Conta de anúncios em dólar: escrever orçamentos em US$ com o equivalente em R$.",
    ],
  };
}

export type ClaudinhoSnapshot = Awaited<ReturnType<typeof buildClaudinhoSnapshot>>;

export const CLAUDINHO_SYSTEM = `Você é o Claudinho, estrategista de tráfego pago (Meta Ads) de um infoprodutor brasileiro que vende pela Cakto.
Sua ÚNICA missão: fazer o dono bater a meta de DINHEIRO LÍQUIDO do mês com tráfego, com o menor risco possível para a conta.
Você é direto, objetivo e prático: cada recomendação tem campanha, número, quando fazer e quando desfazer.

Regras invioláveis:
- Use SOMENTE os números do JSON. Não invente métricas, benchmarks da conta ou resultados. Se faltar dado, diga em "dados_faltando" e recomende "aguardar" com o que observar.
- Você é consultivo: o dono executa. Nunca diga que já fez algo.
- Orçamentos sempre NA MOEDA DA CONTA (campo "orcamento_diario" já traz US$ e o equivalente em R$). Novos valores: calcule em cima do valor na moeda da conta e mostre o equivalente.
- "Vencedor" só com o veredito das regras / teste estatístico. Venda sem origem não é de ninguém.
- Respeite as políticas do Meta e as preferências do dono.

Manual de regras que você segue:
${playbookText()}

Responda em português do Brasil, no formato pedido.`;

/** Plano automático (sem IA): regras + contas, para quando não houver chave ou a IA falhar. */
export function fallbackPlano(s: ClaudinhoSnapshot): Plano {
  const rp = s.ritmo_da_meta;
  const acoes: Plano["acoes_hoje"] = [];
  let prio = 1;
  for (const c of s.campanhas.filter((x) => x.status === "ativa")) {
    const st = c.veredito_regras.status;
    if (st === "pausar") {
      acoes.push({ prioridade: prio++, campanha: c.nome, acao: "pausar", valor_atual: c.orcamento_diario, valor_novo: null, quando: "agora", motivo: c.veredito_regras.resumo, reverter_se: "Se o funil da oferta mudar (novo bump/upsell) e o lucro por cliente ficar positivo." });
    } else if (st === "escalar") {
      const b = c.orcamento_valor;
      const novo = b?.valor != null ? Math.round(b.valor * 1.2 * 100) / 100 : null;
      const sym = b?.moeda === "BRL" ? "R$" : b?.moeda === "USD" ? "US$" : (b?.moeda ?? "");
      acoes.push({ prioridade: prio++, campanha: c.nome, acao: "aumentar_orcamento", valor_atual: c.orcamento_diario,
        valor_novo: b && novo != null ? `${sym} ${fmtDec(novo)}/dia${b.moeda !== "BRL" && b.rs != null ? ` (≈ ${fmtBRL(b.rs * 1.2)})` : ""}` : "+20% sobre o orçamento atual da campanha", quando: "hoje perto da meia-noite (fuso da conta)", motivo: c.veredito_regras.resumo, reverter_se: `CPA 3d acima de ${fmtBRL(c.cpa_maximo_rs)} por 2 dias seguidos.` });
    } else if (st === "otimizar") {
      acoes.push({ prioridade: prio++, campanha: c.nome, acao: "novo_criativo", valor_atual: c.orcamento_diario, valor_novo: null, quando: "esta semana", motivo: c.veredito_regras.resumo, reverter_se: "—" });
    }
  }
  const neg = s.ofertas_7d.filter((o) => (o.lucro_contribuicao_rs ?? 0) < 0);
  return {
    situacao: {
      resumo: `Líquido no mês: ${fmtBRL(rp.liquido_no_mes_rs)} de ${fmtBRL(s.meta_mensal_liquido_rs)}. ${rp.projecao_fim_do_mes_rs != null ? `No ritmo dos últimos 7 dias, o mês fecha em ${fmtBRL(rp.projecao_fim_do_mes_rs)}.` : "Sem 7 dias fechados para projetar."} Faltam ${fmtBRL(rp.falta_rs)} — ${fmtBRL(rp.liquido_por_dia_necessario_rs)} por dia.`,
      vai_bater_a_meta: rp.status === "meta_batida" || rp.status === "no_ritmo" ? "sim" : rp.status === "sem_dados" ? "incerto" : "nao",
    },
    diagnostico: s.ofertas_7d.map((o) => `${o.produto}: ${o.clientes_com_origem} cliente(s), lucro por cliente ${o.lucro_por_cliente_rs == null ? "sem dados" : fmtBRL(o.lucro_por_cliente_rs)}, contribuição ${fmtBRL(o.lucro_contribuicao_rs)} em 7 dias.`).slice(0, 5),
    ofertas: s.ofertas_7d.map((o) => ({
      produto: o.produto,
      papel: o.papel_calculado === "motor" ? "escalar" : o.papel_calculado === "positiva" ? "manter" : o.papel_calculado === "negativa" ? ((o.preco_rs ?? 0) < 20 ? "consertar_funil" : "cortar") : "testar",
      lucro_por_cliente: o.lucro_por_cliente_rs == null ? "sem dados" : fmtBRL(o.lucro_por_cliente_rs),
      explicacao: o.vendas_dia_para_bater_a_meta_sozinha ? `Sozinha, precisaria de ${o.vendas_dia_para_bater_a_meta_sozinha} venda(s)/dia para a meta.` : "Não fecha a meta sozinha com a economia atual.",
    })),
    acoes_hoje: acoes.slice(0, 6),
    plano_7_dias: [],
    alavancas_ticket: neg
      .filter((o) => (o.preco_rs ?? 0) < 20)
      .map((o) => ({ ideia: `Upsell de 1 clique e bump novo em ${o.produto}`, ganho_estimado_por_cliente: "depende da taxa de aceite", como_fazer: "Configure na Cakto e acompanhe o lucro por cliente aqui." })),
    criativos: [],
    regras_de_escala: ["Subir 20% a cada 48–72 h com CPA 3d ≤ alvo e 3+ vendas em 3 dias.", "Voltar ao orçamento anterior se o CPA 3d passar do máximo por 2 dias."],
    nao_fazer: ["Não aplicar recomendações automáticas do Meta.", "Não mexer em orçamento de conjunto/anúncio (CBO)."],
    dados_faltando: env.anthropicApiKey ? [] : ["Plano automático das regras (sem IA): configure ANTHROPIC_API_KEY para o plano completo do Claudinho com criativos e plano de 7 dias."],
  };
}

export async function generateClaudinhoPlan(repo: Repository, goal = DEFAULT_MONTHLY_GOAL): Promise<{ plan: ClaudinhoPlan; usedAi: boolean; warning: string | null }> {
  const snapshot = await buildClaudinhoSnapshot(repo, goal);
  let content = fallbackPlano(snapshot);
  let model = "regras (sem IA)";
  let usedAi = false;
  let warning: string | null = null;
  if (env.anthropicApiKey) {
    try {
      const r = await structured({
        schema: PlanoSchema,
        system: CLAUDINHO_SYSTEM,
        user: `Dados da conta (JSON):\n${JSON.stringify(snapshot)}\n\nMonte o plano para bater a meta de ${fmtBRL(goal)} líquidos neste mês.`,
        effort: "high",
        maxTokens: 20000,
      });
      content = r.data;
      model = r.model;
      usedAi = true;
    } catch (e) {
      warning = `${(e as Error).message} Mostrando o plano automático das regras.`;
    }
  } else {
    warning = "ANTHROPIC_API_KEY não configurada: este é o plano automático das regras.";
  }
  const plan = await savePlan(repo, { goal, model, content, snapshot });
  return { plan, usedAi, warning };
}

// ------------------------------- Armazenamento -------------------------------

const g = globalThis as unknown as { __ccClaudinho?: ClaudinhoPlan[] };

async function savePlan(repo: Repository, p: { goal: number; model: string; content: Plano; snapshot: ClaudinhoSnapshot }): Promise<ClaudinhoPlan> {
  const ctx = await repo.context();
  const plan: ClaudinhoPlan = { id: randomId(8), createdAt: new Date().toISOString(), goal: p.goal, model: p.model, content: p.content };
  if (ctx.mode === "demo") {
    (g.__ccClaudinho ??= []).unshift(plan);
    return plan;
  }
  const supabase = await createSupabaseServer();
  const { data, error } = await supabase
    .from("advisor_reports")
    .insert({
      workspace_id: ctx.workspace.id,
      campaign_id: CLAUDINHO_ID,
      report_date: p.snapshot.data_hoje,
      status: "plano",
      confidence: null,
      signals: [],
      input_snapshot: p.snapshot,
      content: { goal: p.goal, plano: p.content },
      model: p.model,
    })
    .select("id, created_at")
    .single();
  if (error) throw new Error(`Falha ao salvar o plano: ${error.message}`);
  return { ...plan, id: data.id, createdAt: data.created_at };
}

export async function listPlans(repo: Repository, limit = 10): Promise<ClaudinhoPlan[]> {
  const ctx = await repo.context();
  if (ctx.mode === "demo") return (g.__ccClaudinho ?? []).slice(0, limit);
  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from("advisor_reports")
    .select("id, created_at, model, content")
    .eq("workspace_id", ctx.workspace.id)
    .eq("campaign_id", CLAUDINHO_ID)
    .order("created_at", { ascending: false })
    .limit(limit);
  return (data ?? [])
    .filter((r) => r.content?.plano)
    .map((r) => ({ id: r.id as string, createdAt: r.created_at as string, model: (r.model as string) ?? "", goal: Number(r.content.goal) || DEFAULT_MONTHLY_GOAL, content: r.content.plano as Plano }));
}

export type { GoalPacing, OfferEconomics };
