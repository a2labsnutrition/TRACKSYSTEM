import { getRepository } from "@/lib/data";
import { fmtDateTime, fmtInt, fmtPct, fmtRelative } from "@/lib/format";
import { computeDivergence } from "@/lib/metrics/compute";
import { cn, safeDiv } from "@/lib/utils";
import { LiveEvents } from "@/components/live-events";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { LIGHT_LABEL, StatusDot } from "@/components/ui/status-dot";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";

export const metadata = { title: "Saúde do tracking" };

export default async function Saude() {
  const repo = await getRepository();
  const ctx = await repo.context();
  const [h, logs] = await Promise.all([repo.health(), repo.capiLogs(40)]);
  const connect = safeDiv(h.landingPageViews, h.linkClicks);
  const attributedPct = safeDiv(h.ordersAttributed, h.ordersPaid);
  const div = computeDivergence(h.metaPurchases, h.ordersAttributed, 0);
  const capiFailPct = safeDiv(h.capiFailed, h.capiSent + h.capiFailed);

  return (
    <>
      <PageHeader title="Saúde do tracking" description="Recomendação sem dado confiável é pior que nenhuma. Tudo verde aqui = pode confiar nos vereditos. Janela: últimos 7 dias." />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {h.integrations.map((i) => (
          <Card key={i.provider} className={cn(i.status === "error" && "border-bad/40", i.status === "warning" && "border-warn/30")}>
            <CardBody>
              <div className="flex items-center gap-2">
                <StatusDot status={i.status} />
                <span className="text-sm font-semibold">{i.label}</span>
                <span className="ml-auto text-[11px] text-faint">{LIGHT_LABEL[i.status]}</span>
              </div>
              <p className="mt-2 text-xs text-muted">{i.detail}</p>
              <p className="mt-1 text-[11px] text-faint">Último evento: {i.lastEventAt ? `${fmtRelative(i.lastEventAt)} (${fmtDateTime(i.lastEventAt, ctx.workspace.timezone)})` : "nunca"}</p>
              {i.status !== "ok" && i.provider !== "anthropic" ? (
                <LinkButton href="/conexoes" size="sm" variant="secondary" className="mt-3">Corrigir</LinkButton>
              ) : null}
            </CardBody>
          </Card>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric
          label="Vendas atribuídas"
          value={fmtPct(attributedPct, 0)}
          sub={`${h.ordersAttributed} de ${h.ordersPaid} pagas`}
          bad={attributedPct != null && attributedPct < 0.7}
          tip="Percentual das vendas pagas que foram ligadas a uma campanha/anúncio. Abaixo de 70%: confira se o script está na página e se os links de checkout carregam o parâmetro."
        />
        <Metric
          label="Divergência Meta × Cakto"
          value={div.ratio == null ? "—" : fmtPct(div.ratio, 0)}
          sub={`Meta ${fmtInt(h.metaPurchases)} · Cakto ${fmtInt(h.ordersAttributed)}`}
          bad={div.ratio != null && Math.abs(div.ratio) > 0.3}
          tip={div.explanation}
        />
        <Metric
          label="Connect rate"
          value={fmtPct(connect, 0)}
          sub={`${fmtInt(h.landingPageViews)} LP views / ${fmtInt(h.linkClicks)} cliques`}
          bad={connect != null && connect < 0.75}
          tip="Cliques no link que viraram visualização da página. Baixo = página lenta, fora do ar ou redirecionando (parâmetros podem se perder)."
        />
        <Metric
          label="Falhas de envio CAPI"
          value={fmtPct(capiFailPct, 1)}
          sub={`${fmtInt(h.capiFailed)} falhas / ${fmtInt(h.capiSent)} enviados`}
          bad={capiFailPct != null && capiFailPct > 0.02}
          tip="Eventos enviados pelo servidor para a API de Conversões do Meta. Falhas comuns: token sem permissão no Pixel, Pixel ID errado."
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Eventos em tempo real" description="Abra sua página em outra aba e clique: os eventos aparecem aqui." />
          <LiveEvents />
        </Card>

        <Card>
          <CardHeader title="Log da API de Conversões" description="Status de envio e resposta do Meta (últimos 40)" />
          <TableWrap className="max-h-[480px]">
            <Table>
              <thead>
                <tr>
                  <Th>Quando</Th>
                  <Th>Evento</Th>
                  <Th>Origem</Th>
                  <Th>Status</Th>
                  <Th>Resposta</Th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id}>
                    <Td className="text-xs">{fmtRelative(l.createdAt)}</Td>
                    <Td className="text-xs">
                      <span className="font-medium">{l.eventName}</span>
                      <span className="block max-w-40 truncate text-faint" title={l.eventId}>{l.eventId}</span>
                    </Td>
                    <Td className="text-xs text-muted">{{ tracking: "Script", cakto: "Cakto", test: "Teste" }[l.source]}</Td>
                    <Td>
                      <Badge tone={l.status === "sent" ? "good" : l.status === "failed" ? "bad" : "neutral"}>
                        {l.status === "sent" ? "Enviado" : l.status === "failed" ? `Falhou${l.httpStatus ? ` (${l.httpStatus})` : ""}` : "Ignorado"}
                      </Badge>
                    </Td>
                    <Td className="max-w-56 truncate font-mono text-[11px] text-faint" title={l.response ?? ""}>{l.response}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
          {!logs.length ? <p className="p-4 text-sm text-muted">Nenhum envio ainda.</p> : null}
        </Card>
      </div>
    </>
  );
}

function Metric({ label, value, sub, bad, tip }: { label: string; value: string; sub: string; bad?: boolean; tip: string }) {
  return (
    <div className={cn("rounded-xl border bg-panel p-4", bad ? "border-bad/40" : "border-border")}>
      <p className="flex items-center gap-1 text-xs text-muted">
        {label} <InfoTip text={tip} />
      </p>
      <p className={cn("mt-1 text-xl font-semibold tabular", bad && "text-bad")}>{value}</p>
      <p className="text-xs text-faint">{sub}</p>
    </div>
  );
}
