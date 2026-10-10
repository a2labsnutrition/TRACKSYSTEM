import { ATTRIBUTION_LABEL, attributionLevel, LEVEL_LABEL } from "@/lib/attribution/attribute";
import { getRepository } from "@/lib/data";
import { orderParts, type Order, type OrderStatus } from "@/lib/data/types";
import { fmtBRL, fmtDate, fmtDateTime, fmtInt, fmtPct } from "@/lib/format";
import { aggregateOrders } from "@/lib/metrics/compute";
import { periodFrom, sp, type SearchParams } from "@/lib/page";
import { ParamSelect } from "@/components/filters";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodPicker } from "@/components/layout/period-picker";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";

export const metadata = { title: "Vendas" };

const STATUS: Record<OrderStatus, { label: string; tone: Tone }> = {
  paid: { label: "Pago", tone: "good" },
  pending: { label: "Pendente", tone: "warn" },
  refused: { label: "Recusado", tone: "bad" },
  refunded: { label: "Reembolsado", tone: "violet" },
  chargeback: { label: "Chargeback", tone: "bad" },
  abandoned: { label: "Abandonado", tone: "neutral" },
  canceled: { label: "Cancelado", tone: "neutral" },
  unknown: { label: "?", tone: "neutral" },
};

const METHOD: Record<string, string> = { pix: "Pix", credit_card: "Cartão", boleto: "Boleto", other: "Outro" };

export default async function Vendas({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const repo = await getRepository();
  const ctx = await repo.context();
  const period = periodFrom(params, ctx.workspace.timezone);
  const statusF = sp(params, "status") ?? "";
  const attrF = sp(params, "atrib") ?? "";
  const [orders, campaigns] = await Promise.all([repo.orders({ from: period.from, to: period.to }), repo.campaigns()]);
  const names = new Map(campaigns.map((c) => [c.id, c.name]));

  const filtered = orders.filter(
    (o) =>
      (!statusF || o.status === statusF) &&
      (!attrF || (attrF === "nao" ? o.attributionMethod === "unattributed" : o.attributionMethod !== "unattributed")),
  );
  const real = aggregateOrders(orders);
  const paid = orders.filter((o) => o.status === "paid");
  const mainPaid = paid.filter((o) => orderParts(o).kind === "main");
  const levels = { confirmada: 0, provavel: 0, desconhecida: 0 };
  for (const o of mainPaid) levels[attributionLevel(o.attributionMethod)]++;
  const bumpRevenue = paid.reduce((s, o) => s + orderParts(o).bump + orderParts(o).upsell, 0);
  const byMethod = paid.reduce<Record<string, number>>((acc, o) => ((acc[o.attributionMethod] = (acc[o.attributionMethod] ?? 0) + 1), acc), {});

  return (
    <>
      <PageHeader
        title="Vendas"
        description={`Pedidos recebidos da Cakto de ${fmtDate(period.from)} a ${fmtDate(period.to)}. Vendas sem origem identificada aparecem como “Não atribuída” — nunca são descartadas.`}
        actions={<PeriodPicker current={period.key} from={period.from} to={period.to} />}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Box label="Compras principais pagas" value={fmtInt(mainPaid.length)} sub={`${fmtInt(real.paidOrders)} pedido(s) pagos · ${fmtInt(real.generatedOrders)} gerados`} />
        <Box label="Faturamento bruto (pagos)" value={fmtBRL(real.grossRevenue)} sub={`bumps/upsells ${fmtBRL(bumpRevenue)} · após taxas ${fmtBRL(real.netRevenue)}`} />
        <Box
          label="Origem identificada"
          value={fmtPct(mainPaid.length ? (levels.confirmada + levels.provavel) / mainPaid.length : null, 0)}
          sub={`${levels.confirmada} confirmada(s) · ${levels.provavel} provável(is) · ${levels.desconhecida} sem origem`}
        />
        <Box label="Reembolsos/chargebacks" value={fmtInt(real.refunds)} sub={fmtBRL(real.refundedAmount)} />
      </div>

      {paid.length ? (
        <div className="mb-5 flex flex-wrap gap-2 text-xs">
          {Object.entries(byMethod)
            .sort((a, b) => b[1] - a[1])
            .map(([m, n]) => (
              <span key={m} className="rounded-lg border border-border bg-panel px-2.5 py-1.5">
                {ATTRIBUTION_LABEL[m as keyof typeof ATTRIBUTION_LABEL] ?? m}: <b className="tabular">{n}</b>
              </span>
            ))}
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Pedidos"
          action={
            <>
              <ParamSelect
                name="status"
                value={statusF}
                options={[{ value: "", label: "Todos os status" }, ...Object.entries(STATUS).filter(([k]) => k !== "unknown").map(([k, v]) => ({ value: k, label: v.label }))]}
              />
              <ParamSelect
                name="atrib"
                value={attrF}
                options={[
                  { value: "", label: "Atribuídas e não atribuídas" },
                  { value: "sim", label: "Só atribuídas" },
                  { value: "nao", label: "Só não atribuídas" },
                ]}
              />
            </>
          }
        />
        {filtered.length ? (
          <TableWrap className="max-h-[640px]">
            <Table>
              <thead>
                <tr>
                  <Th>Data</Th>
                  <Th>Pedido</Th>
                  <Th>Status</Th>
                  <Th>Método</Th>
                  <Th className="text-right">Bruto</Th>
                  <Th className="text-right">Líquido</Th>
                  <Th>Origem</Th>
                  <Th>Campanha / anúncio</Th>
                  <Th>CAPI</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 500).map((o) => (
                  <OrderRow key={o.id} o={o} campaignName={o.campaignId ? names.get(o.campaignId) ?? o.campaignId : null} tz={ctx.workspace.timezone} />
                ))}
              </tbody>
            </Table>
          </TableWrap>
        ) : (
          <EmptyState title="Nenhum pedido" description="Quando a Cakto enviar o primeiro webhook, os pedidos aparecem aqui. Configure em Conexões → Cakto." />
        )}
        {filtered.length > 500 ? <p className="p-3 text-xs text-faint">Mostrando 500 de {filtered.length}. Use os filtros.</p> : null}
      </Card>
    </>
  );
}

function OrderRow({ o, campaignName, tz }: { o: Order; campaignName: string | null; tz: string }) {
  const st = STATUS[o.status] ?? STATUS.unknown;
  return (
    <tr className="hover:bg-panel-2/50">
      <Td className="text-xs">{fmtDateTime(o.createdAt, tz)}</Td>
      <Td className="max-w-48 truncate text-xs">
        <span className="block truncate font-medium">{o.externalId}</span>
        <span className="text-faint">
          {o.productName ?? "—"}
          {orderParts(o).kind === "bump" ? " · order bump" : orderParts(o).kind === "upsell" ? " · upsell" : ""}
          {orderParts(o).kind === "main" && orderParts(o).bump > 0 ? ` · inclui bump ${fmtBRL(orderParts(o).bump)}` : ""}
        </span>
      </Td>
      <Td>
        <Badge tone={st.tone}>{st.label}</Badge>
      </Td>
      <Td className="text-xs">{METHOD[o.paymentMethod] ?? o.paymentMethod}</Td>
      <Td className="text-right">{fmtBRL(o.grossAmount)}</Td>
      <Td className="text-right">
        {fmtBRL(o.netAmount)}
        {o.netEstimated ? <span className="block text-[11px] text-faint">estimado</span> : null}
      </Td>
      <Td className="text-xs">
        {o.attributionMethod === "unattributed" ? (
          <Badge tone="warn">Desconhecida</Badge>
        ) : (
          <span>
            <Badge tone={attributionLevel(o.attributionMethod) === "confirmada" ? "good" : "info"}>{LEVEL_LABEL[attributionLevel(o.attributionMethod)]}</Badge>{" "}
            <span className="text-faint">{ATTRIBUTION_LABEL[o.attributionMethod]}</span>
          </span>
        )}
      </Td>
      <Td className="max-w-64 truncate text-xs text-muted" title={campaignName ?? o.utmCampaign ?? ""}>
        {campaignName ?? o.utmCampaign ?? "—"}
      </Td>
      <Td className="text-xs">{o.capiPurchaseSentAt ? <Badge tone="good">Purchase enviado</Badge> : o.status === "paid" ? <Badge tone="warn">Não enviado</Badge> : "—"}</Td>
    </tr>
  );
}

function Box({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 whitespace-nowrap text-xl font-semibold tabular">{value}</p>
      {sub ? <p className="text-xs text-faint">{sub}</p> : null}
    </div>
  );
}
