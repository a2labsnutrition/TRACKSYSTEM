import { AlertOctagon, AlertTriangle, ArrowRight, Info } from "lucide-react";
import Link from "next/link";
import { overview } from "@/lib/analytics";
import { getRepository } from "@/lib/data";
import { fmtBRL, fmtDate, fmtInt, fmtPct, fmtRoas, fmtRelative } from "@/lib/format";
import { periodFrom, withPeriod, type SearchParams } from "@/lib/page";
import { cn } from "@/lib/utils";
import { SpendRevenueChart } from "@/components/charts/spend-revenue-chart";
import { DecisionBadge } from "@/components/decision-badge";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodPicker } from "@/components/layout/period-picker";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { Stat } from "@/components/ui/stat";
import { StatusDot } from "@/components/ui/status-dot";
import { LinkButton } from "@/components/ui/button";
import { AnomaliesList } from "@/components/intel/anomalies-list";
import { AttributionSplitView } from "@/components/intel/attribution-split";
import { FinancialBreakdown } from "@/components/intel/financial-breakdown";
import { FreshnessList } from "@/components/intel/freshness";
import { RecommendationCard } from "@/components/intel/recommendation-card";

export default async function VisaoGeral({ searchParams }: { searchParams: SearchParams }) {
  const repo = await getRepository();
  const ctx = await repo.context();
  const period = periodFrom(await searchParams, ctx.workspace.timezone);
  const o = await overview(repo, period);
  const { cur, prev } = o;

  const noAccounts = ctx.mode === "live" && ctx.adAccounts.length === 0;

  return (
    <>
      <PageHeader
        title="Como estão minhas campanhas"
        description={`${fmtDate(period.from)} a ${fmtDate(period.to)} · comparado com ${fmtDate(period.prevFrom)} a ${fmtDate(period.prevTo)}`}
        actions={<PeriodPicker current={period.key} from={period.from} to={period.to} />}
      />

      {noAccounts ? (
        <Card className="mb-5 border-primary/40 bg-primary/5">
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-semibold">Conecte sua conta Meta para começar</p>
              <p className="text-sm text-muted">Em ~10 minutos: Meta → script na página → Cakto → primeiro produto → primeiro dado.</p>
            </div>
            <LinkButton href="/conexoes">Abrir assistente de conexões</LinkButton>
          </CardBody>
        </Card>
      ) : null}

      {o.alerts.length ? (
        <div className="mb-5 grid grid-cols-1 gap-2">
          {o.alerts.slice(0, 5).map((a, i) => {
            const Icon = a.severity === "critico" ? AlertOctagon : a.severity === "atencao" ? AlertTriangle : Info;
            return (
              <Link
                key={i}
                href={a.href ? withPeriod(a.href, period) : "#"}
                className={cn(
                  "flex items-start gap-3 rounded-lg border px-3 py-2.5 text-sm transition-colors",
                  a.severity === "critico" ? "border-bad/30 bg-bad/5 hover:bg-bad/10" : "border-warn/30 bg-warn/5 hover:bg-warn/10",
                )}
              >
                <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", a.severity === "critico" ? "text-bad" : "text-warn")} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{a.title}</span>
                  <span className="block text-xs text-muted">{a.detail}</span>
                </span>
                <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-faint" />
              </Link>
            );
          })}
          {o.alerts.length > 5 ? <p className="text-xs text-faint">+{o.alerts.length - 5} alerta(s)</p> : null}
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <Stat
          label="Gasto"
          metric="spend"
          value={fmtBRL(cur.meta.spend)}
          current={cur.meta.spend}
          previous={prev.meta.spend}
          neutral
          sub={cur.fx.missing ? "parte sem cotação!" : cur.fx.estimated ? "câmbio estimado" : undefined}
          className={cur.fx.missing ? "border-bad/40" : undefined}
        />
        <Stat
          label="Faturamento bruto"
          metric="grossRevenue"
          value={fmtBRL(cur.fin.grossApproved)}
          current={cur.fin.grossApproved}
          previous={prev.fin.grossApproved}
          sub={cur.fin.bumpRevenue || cur.fin.upsellRevenue ? `bumps/upsells ${fmtBRL(cur.fin.bumpRevenue + cur.fin.upsellRevenue)}` : `− tráfego: ${fmtBRL(cur.fin.grossMinusAds)}`}
        />
        <Stat
          label="Líquido Cakto"
          value={fmtBRL(cur.fin.revenueAfterRefunds - cur.fin.fees)}
          current={cur.fin.revenueAfterRefunds - cur.fin.fees}
          previous={prev.fin.revenueAfterRefunds - prev.fin.fees}
          sub="o que a Cakto paga (vendas pagas − taxa Cakto)"
          className="border-primary/30"
        />
        <Stat
          label="Sobra (líquido − anúncios)"
          metric="profit"
          value={fmtBRL(cur.fin.contribution)}
          current={cur.fin.contribution}
          previous={prev.fin.contribution}
          sub={cur.fin.taxes || cur.fin.variableCosts ? "também desconta impostos/custos configurados" : "Líquido Cakto − gasto com anúncios"}
          className={cur.fin.contribution < 0 ? "border-bad/40" : cur.fin.contribution > 0 ? "border-good/30" : ""}
        />
        <Stat label="ROAS bruto" metric="roasReal" value={fmtRoas(cur.fin.roasGross)} current={cur.fin.roasGross} previous={prev.fin.roasGross} sub={`Meta: ${fmtRoas(cur.derived.roasMeta)}`} />
        <Stat label="CPA" metric="cpaReal" value={fmtBRL(cur.fin.cpa)} current={cur.fin.cpa} previous={prev.fin.cpa} higherIsBetter={false} sub={`Meta: ${fmtBRL(cur.derived.cpaMeta)}`} />
        <Stat label="Compras (principal)" metric="purchases" value={fmtInt(cur.fin.mainPurchases)} current={cur.fin.mainPurchases} previous={prev.fin.mainPurchases} sub={`Meta: ${fmtInt(cur.meta.purchases)}`} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Gasto × faturamento × contribuição por dia"
            description="Gasto no fuso da conta de anúncios; faturamento pela data de pagamento na Cakto; contribuição estimada."
            action={<LinkButton href={withPeriod("/gasto-diario", period)} variant="ghost" size="sm">Detalhar <ArrowRight className="h-3.5 w-3.5" /></LinkButton>}
          />
          <CardBody>
            <SpendRevenueChart data={o.daily} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Resultado financeiro" description="Cada parcela separada — nenhuma delas é lucro líquido" />
          <CardBody>
            <FinancialBreakdown fin={cur.fin} spendEstimated={cur.fx.estimated} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="Recomendações priorizadas"
            description="Consultivas: você decide e executa. Cada uma traz dados, confiança, riscos, impacto e quando reavaliar."
          />
          <CardBody className="space-y-2">
            {o.recommendations.length ? (
              o.recommendations.slice(0, 5).map((r, i) => (
                <RecommendationCard key={`${r.campaignId}-${r.action}-${i}`} rec={r} campaignName={r.campaignName} href={withPeriod(`/campanhas/${r.campaignId}`, period)} compact />
              ))
            ) : (
              <p className="text-sm text-muted">Nenhuma campanha ativa para recomendar.</p>
            )}
            {o.recommendations.length > 5 ? <p className="text-xs text-faint">+{o.recommendations.length - 5} recomendação(ões) nas páginas das campanhas.</p> : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Qualidade dos dados" description="Origem das vendas e atualização das fontes" />
          <CardBody className="space-y-4">
            <AttributionSplitView split={cur.attribution} metaPurchases={cur.meta.purchases} />
            <div className="border-t border-border pt-3">
              <FreshnessList items={o.freshness} fx={cur.fx} />
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Anomalias" description="Só aparece como anomalia o que é improvável como variação normal (teste indicado em cada item)." />
          <CardBody>
            <AnomaliesList checks={o.anomalies} withPeriod={(h) => withPeriod(h, period)} />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Funil e tracking" description="Onde o dinheiro se perde" />
          <CardBody className="space-y-3 text-sm">
            <Row label="CPM" metric="cpm" value={fmtBRL(cur.derived.cpm)} />
            <Row label="CTR (link)" metric="ctrLink" value={fmtPct(cur.derived.ctrLink, 2)} />
            <Row label="Connect rate" metric="connectRate" value={fmtPct(cur.derived.connectRate)} bad={cur.derived.connectRate != null && cur.derived.connectRate < 0.75} />
            <Row label="Taxa de checkout" metric="checkoutRate" value={fmtPct(cur.derived.checkoutRate)} />
            <Row label="Taxa de compra" metric="purchaseRate" value={fmtPct(cur.derived.purchaseRate)} />
            <div className="border-t border-border pt-3">
              <p className="mb-2 flex items-center gap-1 text-xs font-medium text-muted">
                Aprovação por método <InfoTip metric="approvalRate" />
              </p>
              {Object.entries(cur.real.byMethod).length ? (
                Object.entries(cur.real.byMethod).map(([m, v]) => (
                  <div key={m} className="flex justify-between text-xs">
                    <span className="text-muted">{{ pix: "Pix", credit_card: "Cartão", boleto: "Boleto", other: "Outro" }[m] ?? m}</span>
                    <span className="tabular">
                      {fmtPct(v.approvalRate, 0)} <span className="text-faint">({v.paid}/{v.generated})</span>
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-xs text-faint">Sem pedidos no período.</p>
              )}
            </div>
            <div className="border-t border-border pt-3">
              <p className="mb-1 flex items-center gap-1 text-xs font-medium text-muted">
                Divergência Meta × Cakto <InfoTip metric="divergence" />
              </p>
              <p className="text-xs">
                Meta: <b className="tabular">{fmtInt(o.divergence.metaPurchases)}</b> · Cakto (compras principais atribuídas a anúncios): <b className="tabular">{fmtInt(o.divergence.realPurchases)}</b> · sem origem: <b className="tabular">{fmtInt(cur.attribution.desconhecida)}</b>
                {o.divergence.ratio != null ? <span className="text-faint"> ({fmtPct(o.divergence.ratio, 0)})</span> : null}
              </p>
              <p className="mt-1 text-xs text-muted">{o.divergence.explanation}</p>
            </div>
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader
            title="O que fazer agora"
            description="Veredito do motor para cada campanha com gasto no período"
            action={<LinkButton href={withPeriod("/campanhas", period)} variant="ghost" size="sm">Todas <ArrowRight className="h-3.5 w-3.5" /></LinkButton>}
          />
          <div className="divide-y divide-border">
            {o.top.length ? (
              o.top.map((r) => (
                <Link key={r.campaign.id} href={withPeriod(`/campanhas/${r.campaign.id}`, period)} className="flex items-center gap-3 px-4 py-3 hover:bg-panel-2/60">
                  <DecisionBadge status={r.decision.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.campaign.name}</span>
                    <span className="block truncate text-xs text-muted">{r.decision.headline}</span>
                  </span>
                  <span className="hidden text-right text-xs tabular sm:block">
                    <span className="block">{fmtBRL(r.periodSpend)}</span>
                    <span className="block text-faint">
                      CPA {fmtBRL(r.period.fin.cpa)} · confiança {r.decision.confidence}
                    </span>
                  </span>
                </Link>
              ))
            ) : (
              <p className="px-4 py-6 text-sm text-muted">Nenhuma campanha com gasto no período.</p>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Saúde das conexões" action={<LinkButton href="/saude" variant="ghost" size="sm">Abrir</LinkButton>} />
          <CardBody className="space-y-3">
            {o.health.integrations.map((i) => (
              <div key={i.provider} className="flex items-start gap-2.5 text-sm">
                <StatusDot status={i.status} className="mt-1.5" />
                <div className="min-w-0">
                  <p className="font-medium">{i.label}</p>
                  <p className="text-xs text-muted">
                    {i.detail}
                    {i.lastEventAt ? ` · ${fmtRelative(i.lastEventAt)}` : ""}
                  </p>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Row({ label, metric, value, bad }: { label: string; metric: string; value: string; bad?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="flex items-center gap-1 text-muted">
        {label} <InfoTip metric={metric} />
      </span>
      <span className={cn("font-medium tabular", bad && "text-bad")}>{value}</span>
    </div>
  );
}
