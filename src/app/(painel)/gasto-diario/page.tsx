import { Download } from "lucide-react";
import { spendByDay } from "@/lib/analytics";
import { getRepository } from "@/lib/data";
import { fmtBRL, fmtDate, fmtDayShort, fmtInt, fmtRoas } from "@/lib/format";
import { periodFrom, sp, type SearchParams } from "@/lib/page";
import { cn } from "@/lib/utils";
import { SpendRevenueChart } from "@/components/charts/spend-revenue-chart";
import { ParamSelect } from "@/components/filters";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodPicker } from "@/components/layout/period-picker";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";

export const metadata = { title: "Gasto por dia" };

export default async function GastoDiario({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const repo = await getRepository();
  const ctx = await repo.context();
  const period = periodFrom(params, ctx.workspace.timezone);
  const levelParam = sp(params, "nivel");
  const level = levelParam === "adset" || levelParam === "ad" ? levelParam : "campaign";
  const campaignId = sp(params, "campanha") || undefined;

  const [m, campaigns] = await Promise.all([spendByDay(repo, period, { level, campaignId }), repo.campaigns()]);
  const exportQs = new URLSearchParams({ p: period.key, from: period.from, to: period.to, nivel: level, ...(campaignId ? { campanha: campaignId } : {}) });
  const levelLabel = { campaign: "Campanha", adset: "Conjunto", ad: "Anúncio" }[level];
  const totalRevenue = m.daily.reduce((s, d) => s + d.revenue, 0);
  const totalProfit = m.daily.reduce((s, d) => s + d.profit, 0);
  const totalPurchases = m.daily.reduce((s, d) => s + d.purchases, 0);

  return (
    <>
      <PageHeader
        title="Gasto por dia"
        description={`Valor gasto em cada ${levelLabel.toLowerCase()} por dia (${fmtDate(period.from)} a ${fmtDate(period.to)}), no fuso da conta de anúncios.`}
        actions={
          <>
            <PeriodPicker current={period.key} from={period.from} to={period.to} />
            <a
              href={`/api/export/gasto-diario?${exportQs.toString()}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-panel-2 px-3 text-xs font-medium hover:bg-border"
            >
              <Download className="h-3.5 w-3.5" /> Exportar CSV
            </a>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ParamSelect
          name="nivel"
          value={level}
          options={[
            { value: "campaign", label: "Por campanha" },
            { value: "adset", label: "Por conjunto" },
            { value: "ad", label: "Por anúncio" },
          ]}
        />
        <ParamSelect
          name="campanha"
          value={campaignId ?? ""}
          className="max-w-xs"
          options={[{ value: "", label: "Todas as campanhas" }, ...campaigns.map((c) => ({ value: c.id, label: c.name }))]}
        />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Summary label="Gasto no período" value={fmtBRL(m.grandTotal)} />
        <Summary label="Faturamento bruto" value={fmtBRL(totalRevenue)} />
        <Summary label="Contribuição (est.)" value={fmtBRL(totalProfit)} tone={totalProfit < 0 ? "bad" : "good"} />
        <Summary label="ROAS bruto" value={fmtRoas(m.grandTotal ? totalRevenue / m.grandTotal : null)} sub={`${fmtInt(totalPurchases)} compras principais`} />
      </div>

      <Card className="mb-5">
        <CardHeader title="Gasto × faturamento × contribuição" description={campaignId ? "Faturamento das vendas atribuídas à campanha selecionada" : "Faturamento de todas as vendas aprovadas"} />
        <CardBody>
          <SpendRevenueChart data={m.daily} height={260} />
        </CardBody>
      </Card>

      <Card className="mb-5">
        <CardHeader title={`Gasto por ${levelLabel.toLowerCase()} e dia`} description="Role para o lado no celular. Última linha = total do dia." />
        {m.entities.length ? (
          <TableWrap className="max-h-[560px]">
            <Table>
              <thead>
                <tr>
                  <Th className="sticky left-0 z-10 min-w-56">{levelLabel}</Th>
                  {m.dates.map((d) => (
                    <Th key={d} className="text-right">{fmtDayShort(d)}</Th>
                  ))}
                  <Th className="text-right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {m.entities.map((e) => (
                  <tr key={e.id} className="hover:bg-panel-2/50">
                    <Td className="sticky left-0 max-w-72 truncate bg-panel text-xs" title={e.name}>{e.name}</Td>
                    {m.dates.map((d) => (
                      <Td key={d} className={cn("text-right text-xs", !e.byDate[d] && "text-faint")}>
                        {e.byDate[d] ? fmtBRL(e.byDate[d]) : "—"}
                      </Td>
                    ))}
                    <Td className="text-right text-xs font-semibold">{fmtBRL(e.total)}</Td>
                  </tr>
                ))}
                <tr className="bg-panel-2/60 font-semibold">
                  <Td className="sticky left-0 bg-panel-2 text-xs">Total do dia</Td>
                  {m.dates.map((d) => (
                    <Td key={d} className="text-right text-xs">{fmtBRL(m.totals[d])}</Td>
                  ))}
                  <Td className="text-right text-xs">{fmtBRL(m.grandTotal)}</Td>
                </tr>
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title="Sem gasto no período" description="Escolha outro período ou verifique se a sincronização com o Meta está ativa em Saúde do tracking." />
        )}
      </Card>

      <Card>
        <CardHeader title="Resumo diário" description="Gasto, faturamento, lucro de contribuição estimado e acumulados" />
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Dia</Th>
                <Th className="text-right">Gasto</Th>
                <Th className="text-right">Faturamento</Th>
                <Th className="text-right">Contribuição</Th>
                <Th className="text-right">Vendas</Th>
                <Th className="text-right">CPA</Th>
                <Th className="text-right">ROAS bruto</Th>
                <Th className="text-right">Gasto acum.</Th>
                <Th className="text-right">Contrib. acum.</Th>
              </tr>
            </thead>
            <tbody>
              {[...m.daily].reverse().map((d) => (
                <tr key={d.date} className="hover:bg-panel-2/50">
                  <Td>{fmtDate(d.date)}</Td>
                  <Td className="text-right">{fmtBRL(d.spend)}</Td>
                  <Td className="text-right">{fmtBRL(d.revenue)}</Td>
                  <Td className={cn("text-right font-medium", d.profit < 0 ? "text-bad" : d.profit > 0 ? "text-good" : "")}>{fmtBRL(d.profit)}</Td>
                  <Td className="text-right">{fmtInt(d.purchases)}</Td>
                  <Td className="text-right">{fmtBRL(d.cpa)}</Td>
                  <Td className="text-right">{fmtRoas(d.roas)}</Td>
                  <Td className="text-right text-muted">{fmtBRL(d.cumSpend)}</Td>
                  <Td className={cn("text-right", d.cumProfit < 0 ? "text-bad" : "text-good")}>{fmtBRL(d.cumProfit)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>
    </>
  );
}

function Summary({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={cn("mt-1 whitespace-nowrap text-xl font-semibold tabular", tone === "bad" && "text-bad", tone === "good" && "text-good")}>{value}</p>
      {sub ? <p className="text-xs text-faint">{sub}</p> : null}
    </div>
  );
}
