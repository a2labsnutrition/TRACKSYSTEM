import "server-only";
import { campaignDetail } from "@/lib/analytics";
import { demoReports } from "./memory";
import type { Repository } from "@/lib/data/repository";
import type { AdvisorReport } from "@/lib/data/types";
import { env } from "@/lib/env";
import { createSupabaseServer } from "@/lib/supabase/server";
import { todayIn, type Period } from "@/lib/tz";
import { randomId } from "@/lib/utils";
import { fallbackParecer } from "./fallback";
import { AdvisorError, generateWithClaude } from "./generate";
import { buildSnapshot, type Snapshot } from "./snapshot";

/** Monta o retrato da campanha (o mesmo usado no Parecer e no chat). */
export async function campaignSnapshot(repo: Repository, campaignId: string, period: Period): Promise<Snapshot | null> {
  const ctx = await repo.context();
  const [detail, health, previous] = await Promise.all([
    campaignDetail(repo, campaignId, period),
    repo.health(),
    repo.advisorReports(campaignId, 1),
  ]);
  if (!detail) return null;
  return buildSnapshot(detail, health, previous[0] ?? null, todayIn(ctx.workspace.timezone));
}

export interface CreateResult {
  report: AdvisorReport;
  usedAi: boolean;
  warning: string | null;
}

/**
 * Gera e salva um Parecer. Com ANTHROPIC_API_KEY usa o Claude; sem chave (ou se
 * a IA falhar) salva o parecer automático das regras e avisa.
 */
export async function createParecer(
  repo: Repository,
  campaignId: string,
  period: Period,
  opts: { userId?: string | null; forceFallback?: boolean } = {},
): Promise<CreateResult> {
  const ctx = await repo.context();
  const snapshot = await campaignSnapshot(repo, campaignId, period);
  if (!snapshot) throw new AdvisorError("Campanha não encontrada.");

  let content = fallbackParecer(snapshot);
  let model = "regras (sem IA)";
  let usedAi = false;
  let warning: string | null = null;
  if (!opts.forceFallback && env.anthropicApiKey) {
    try {
      const r = await generateWithClaude(snapshot);
      content = r.content;
      model = r.model;
      usedAi = true;
    } catch (e) {
      warning = `${(e as Error).message} Mostrando o parecer automático das regras.`;
    }
  } else if (!env.anthropicApiKey) {
    warning = "ANTHROPIC_API_KEY não configurada: este é o parecer automático das regras. Configure a chave para o parecer completo da IA.";
  }

  const report: AdvisorReport = {
    id: randomId(8),
    campaignId,
    reportDate: snapshot.data_hoje,
    createdAt: new Date().toISOString(),
    status: content.veredito.status,
    rulesStatus: snapshot.veredito_regras.status,
    confidence: content.veredito.confianca,
    model,
    content,
    targets: {
      maxCpa: snapshot.metas.cpa_maximo_rs,
      killSpendMultiple: snapshot.metas.cpa_maximo_rs ? (snapshot.metas.gasto_sem_venda_para_sinal_forte_rs ?? 0) / snapshot.metas.cpa_maximo_rs || null : null,
    },
  };

  if (ctx.mode === "demo") {
    demoReports().push(report);
  } else {
    const supabase = await createSupabaseServer();
    const { data, error } = await supabase
      .from("advisor_reports")
      .insert({
        workspace_id: ctx.workspace.id,
        campaign_id: campaignId,
        report_date: report.reportDate,
        status: report.status,
        rules_status: report.rulesStatus,
        confidence: report.confidence,
        signals: snapshot.veredito_regras.sinais,
        input_snapshot: snapshot,
        content,
        model,
        created_by: opts.userId ?? null,
      })
      .select("id, created_at")
      .single();
    if (error) throw new AdvisorError(`Falha ao salvar o parecer: ${error.message}`);
    report.id = data.id;
    report.createdAt = data.created_at;
  }
  return { report, usedAi, warning };
}
