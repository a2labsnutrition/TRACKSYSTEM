import { campaignRows } from "@/lib/analytics";
import { getRepository } from "@/lib/data";
import { STATUS_LABEL, type DecisionStatus } from "@/lib/decision/rules";
import { fmtBRL, fmtDate } from "@/lib/format";
import { periodFrom, type SearchParams } from "@/lib/page";
import { CampaignsTable, type CampaignTableRow } from "@/components/campaigns-table";
import { DecisionBadge } from "@/components/decision-badge";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodPicker } from "@/components/layout/period-picker";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Campanhas" };

export default async function Campanhas({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const repo = await getRepository();
  const ctx = await repo.context();
  const period = periodFrom(params, ctx.workspace.timezone);
  const rows = await campaignRows(repo, period);

  const tableRows: CampaignTableRow[] = rows.map((r) => ({
    id: r.campaign.id,
    name: r.campaign.name,
    active: r.campaign.effectiveStatus === "ACTIVE",
    status: r.decision.status,
    headline: r.decision.headline,
    budget: r.campaign.dailyBudget ? `${fmtBRL(r.campaign.dailyBudget)}/dia (CBO)` : r.campaign.budgetType === "ABO" ? "Por conjunto (ABO)" : "—",
    spend: r.period.meta.spend,
    revenue: r.period.fin.grossApproved,
    profit: r.period.fin.contribution,
    purchases: r.period.fin.mainPurchases,
    metaPurchases: r.period.meta.purchases,
    cpa: r.period.fin.cpa,
    roas: r.period.fin.roasGross,
    ctr: r.period.derived.ctrLink,
    cpm: r.period.derived.cpm,
    connectRate: r.period.derived.connectRate,
    frequency: r.period.derived.frequency,
    hookRate: r.period.derived.hookRate,
    w1: r.w1,
    w3: r.w3,
    w7: r.w7,
  }));

  const counts = rows
    .filter((r) => r.campaign.effectiveStatus === "ACTIVE")
    .reduce<Record<string, number>>((acc, r) => ((acc[r.decision.status] = (acc[r.decision.status] ?? 0) + 1), acc), {});
  const pq = new URLSearchParams({ p: period.key, ...(period.key === "custom" ? { from: period.from, to: period.to } : {}) }).toString();

  return (
    <>
      <PageHeader
        title="Campanhas"
        description={`Métricas do período ${fmtDate(period.from)} a ${fmtDate(period.to)}. Vereditos e janelas 1d/3d/7d contam sempre até hoje.`}
        actions={<PeriodPicker current={period.key} from={period.from} to={period.to} />}
      />
      {Object.keys(counts).length ? (
        <div className="mb-4 flex flex-wrap gap-2">
          {(["pausar", "otimizar", "escalar", "manter", "aguardar"] as DecisionStatus[])
            .filter((s) => counts[s])
            .map((s) => (
              <span key={s} className="inline-flex items-center gap-2 rounded-lg border border-border bg-panel px-3 py-1.5 text-sm">
                <DecisionBadge status={s} />
                <b className="tabular">{counts[s]}</b>
                <span className="sr-only">{STATUS_LABEL[s]}</span>
              </span>
            ))}
        </div>
      ) : null}
      <Card>
        {rows.length ? (
          <CampaignsTable rows={tableRows} periodQuery={pq} />
        ) : (
          <EmptyState
            title="Nenhuma campanha ainda"
            description="Conecte sua conta Meta para sincronizar campanhas, conjuntos e anúncios."
            action={<LinkButton href="/conexoes">Conectar Meta</LinkButton>}
          />
        )}
      </Card>
    </>
  );
}
