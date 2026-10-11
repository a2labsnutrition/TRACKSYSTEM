import "server-only";
import { costSettings, dailySeries, decisionConfigFor } from "@/lib/analytics";
import type { Repository } from "@/lib/data/repository";
import type { AdvisorReport, Campaign } from "@/lib/data/types";
import { addDays, resolvePeriod, todayIn } from "@/lib/tz";
import { groupBy } from "@/lib/utils";
import { accuracySummary, evaluateOutcome, type AccuracySummary, type OutcomeTargets, type ReportOutcome } from "./outcome";

/** Só pareceres recentes entram na comparação (limita o volume de insights lidos). */
const LOOKBACK_DAYS = 120;

export interface OutcomeRow {
  report: AdvisorReport;
  campaign: Campaign | null;
  outcome: ReportOutcome;
}

/**
 * Para cada parecer salvo, mede o que aconteceu nos 7 dias seguintes
 * (gasto, compras principais com origem, CPA, ROAS) e julga o veredito do
 * consultor e o das regras. Sem `campaignId`: todas as campanhas.
 */
export async function reportOutcomes(repo: Repository, opts: { campaignId?: string; limit?: number } = {}): Promise<{ rows: OutcomeRow[]; summary: AccuracySummary }> {
  const ctx = await repo.context();
  const wsTz = ctx.workspace.timezone;
  const minDate = addDays(todayIn(wsTz), -LOOKBACK_DAYS);
  const reports = (await repo.advisorReports(opts.campaignId, opts.limit ?? 200)).filter((r) => r.reportDate >= minDate);
  if (!reports.length) return { rows: [], summary: accuracySummary([]) };

  const from = addDays(reports.reduce((m, r) => (r.reportDate < m ? r.reportDate : m), reports[0].reportDate), -6);
  const to = todayIn(wsTz);
  const [campaigns, products, ins, orders] = await Promise.all([
    repo.campaigns(),
    repo.products(),
    repo.insights({ level: "campaign", from, to, campaignId: opts.campaignId }),
    repo.orders({ from, to }),
  ]);
  const costs = costSettings(ctx.workspace, products);
  const insByCampaign = groupBy(ins, (r) => r.entityId);
  const ordersByCampaign = groupBy(
    orders.filter((o) => o.campaignId),
    (o) => o.campaignId!,
  );

  const seriesCache = new Map<string, { days: ReturnType<typeof dailySeries>; today: string }>();
  const rows: OutcomeRow[] = reports.map((report) => {
    const campaign = campaigns.find((c) => c.id === report.campaignId) ?? null;
    const tz = (campaign && ctx.adAccounts.find((a) => a.id === campaign.adAccountId)?.timezone) || wsTz;
    let s = seriesCache.get(report.campaignId);
    if (!s) {
      const period = resolvePeriod(tz, "custom", from, todayIn(tz));
      s = {
        days: dailySeries(insByCampaign.get(report.campaignId) ?? [], ordersByCampaign.get(report.campaignId) ?? [], period, tz, costs),
        today: todayIn(tz),
      };
      seriesCache.set(report.campaignId, s);
    }
    const product = campaign?.productId ? (products.find((p) => p.id === campaign.productId) ?? null) : null;
    const current = decisionConfigFor(product, ctx.workspace, null);
    const targets: OutcomeTargets =
      report.targets?.maxCpa && report.targets.maxCpa > 0
        ? { maxCpa: report.targets.maxCpa, killSpendMultiple: report.targets.killSpendMultiple ?? current.killSpendMultiple, source: "parecer" }
        : { maxCpa: current.maxCpa, killSpendMultiple: current.killSpendMultiple, source: "atual" };
    const outcome = evaluateOutcome(
      report,
      s.days.map((d) => ({ date: d.date, spend: d.spend, purchases: d.purchases, revenue: d.revenue })),
      targets,
      s.today,
    );
    return { report, campaign, outcome };
  });

  return { rows, summary: accuracySummary(rows.map((r) => r.outcome)) };
}
