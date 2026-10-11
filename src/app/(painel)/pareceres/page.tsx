import { ArrowRight, History } from "lucide-react";
import Link from "next/link";
import { EVIDENCE_LABEL, type Scoreboard } from "@/lib/advisor/outcome";
import { reportOutcomes } from "@/lib/advisor/outcomes-service";
import { getRepository } from "@/lib/data";
import { STATUS_LABEL } from "@/lib/decision/rules";
import { fmtBRL, fmtDate, fmtInt, fmtPct } from "@/lib/format";
import { OutcomeBadge } from "@/components/advisor/outcome-view";
import { DecisionBadge } from "@/components/decision-badge";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";

export const metadata = { title: "Acerto dos pareceres" };
export const maxDuration = 60;

function rateText(b: Scoreboard) {
  if (b.rate == null) return "—";
  return fmtPct(b.rate, 0);
}

function ScoreCard({ title, board, note }: { title: string; board: Scoreboard; note: string }) {
  const decided = board.acertos + board.erros;
  return (
    <Card>
      <CardHeader title={title} description={note} />
      <CardBody>
        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-semibold tabular">{rateText(board)}</span>
          <span className="text-xs text-muted">de acerto em {fmtInt(decided)} caso(s) decidido(s)</span>
        </div>
        {board.rateLower != null && board.rateUpper != null ? (
          <p className="mt-1 text-xs text-faint">
            Intervalo de 95%: {fmtPct(board.rateLower, 0)} a {fmtPct(board.rateUpper, 0)}
            {decided < 10 ? " — poucos casos, ainda pouco confiável" : ""}
          </p>
        ) : null}
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
          {[
            ["Acertou", board.acertos, "text-good"],
            ["Errou", board.erros, "text-bad"],
            ["Inconclusivo", board.inconclusivos, "text-warn"],
            ["Não avaliável", board.naoAvaliaveis, "text-muted"],
            ["Aguardando", board.aguardando, "text-info"],
          ].map(([label, v, cls]) => (
            <div key={label as string} className="min-w-0 rounded-lg border border-border px-2 py-1.5">
              <dt className="truncate text-faint">{label}</dt>
              <dd className={`text-base font-semibold tabular ${cls}`}>{fmtInt(v as number)}</dd>
            </div>
          ))}
        </dl>
      </CardBody>
    </Card>
  );
}

export default async function Pareceres() {
  const repo = await getRepository();
  const { rows, summary } = await reportOutcomes(repo, { limit: 200 });

  return (
    <>
      <PageHeader
        title="Acerto dos pareceres"
        description="Para cada parecer salvo: o que foi sugerido e o que aconteceu nos 7 dias seguintes. Acerto só conta quando o intervalo de 95% do CPA depois do parecer fica inteiro de um lado do CPA máximo."
      />

      {!rows.length ? (
        <Card>
          <EmptyState
            icon={<History className="h-8 w-8" />}
            title="Nenhum parecer nos últimos 120 dias"
            description="Gere um parecer na página de uma campanha. Depois de 3 dias completos, ele aparece aqui comparado com o que aconteceu."
            action={
              <Link href="/campanhas" className="text-sm text-primary hover:underline">
                Ir para campanhas
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <ScoreCard title="Parecer do Consultor" board={summary.consultant} note="Veredito final do parecer (IA ou automático)." />
            <ScoreCard title="Motor de regras" board={summary.rules} note="Veredito das regras no momento do parecer." />
          </div>

          <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
            <Card className="xl:col-span-2">
              <CardHeader title="Acerto das regras por veredito" description="“Otimizar” e “Aguardar” não têm resultado esperado objetivo — por isso não entram no acerto." />
              <TableWrap>
                <Table>
                  <thead>
                    <tr>
                      <Th>Veredito das regras</Th>
                      <Th className="text-right">Acertou</Th>
                      <Th className="text-right">Errou</Th>
                      <Th className="text-right">Inconclusivo</Th>
                      <Th className="text-right">Não avaliável</Th>
                      <Th className="text-right">Aguardando</Th>
                      <Th className="text-right">Acerto</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.byStatus.map(({ status, board }) => (
                      <tr key={status}>
                        <Td>
                          <DecisionBadge status={status} />
                        </Td>
                        <Td className="text-right">{fmtInt(board.acertos)}</Td>
                        <Td className="text-right">{fmtInt(board.erros)}</Td>
                        <Td className="text-right">{fmtInt(board.inconclusivos)}</Td>
                        <Td className="text-right">{fmtInt(board.naoAvaliaveis)}</Td>
                        <Td className="text-right">{fmtInt(board.aguardando)}</Td>
                        <Td className="text-right font-medium">{rateText(board)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </Table>
              </TableWrap>
            </Card>
            <Card>
              <CardHeader title="Quando discordaram" description="Consultor e regras deram vereditos diferentes." />
              <CardBody className="space-y-2 text-sm">
                <p>
                  Consultor acertou: <span className="font-semibold tabular">{fmtInt(summary.disagreements.consultantRight)}</span>
                </p>
                <p>
                  Regras acertaram: <span className="font-semibold tabular">{fmtInt(summary.disagreements.rulesRight)}</span>
                </p>
                <p className="text-muted">
                  Sem definição ainda: <span className="tabular">{fmtInt(summary.disagreements.undecided)}</span>
                </p>
                <p className="pt-2 text-xs text-faint">
                  Pareceres seguidos de uma mesma campanha olham para dias que se sobrepõem — não são casos independentes. Conta-se 1 parecer por campanha por dia.
                </p>
              </CardBody>
            </Card>
          </div>

          <Card className="mt-5">
            <CardHeader title={`Pareceres (${rows.length})`} description="Mais recentes primeiro. “Depois” = até 7 dias completos após a data do parecer." />
            <TableWrap>
              <Table>
                <thead>
                  <tr>
                    <Th>Data</Th>
                    <Th>Campanha</Th>
                    <Th>Parecer</Th>
                    <Th>Regras</Th>
                    <Th className="text-right">Dias depois</Th>
                    <Th className="text-right">Gasto depois</Th>
                    <Th className="text-right">Vendas</Th>
                    <Th className="text-right">CPA depois</Th>
                    <Th className="text-right">CPA máx.</Th>
                    <Th>Resultado</Th>
                    <Th>Parecer acertou?</Th>
                    <Th>Regras acertaram?</Th>
                    <Th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ report, campaign, outcome: o }) => (
                    <tr key={report.id}>
                      <Td>{fmtDate(report.reportDate)}</Td>
                      <Td className="max-w-[16rem] truncate" title={campaign?.name ?? report.campaignId}>
                        {campaign?.name ?? report.campaignId}
                      </Td>
                      <Td>
                        <DecisionBadge status={o.status} />
                      </Td>
                      <Td>{o.rulesStatus ? STATUS_LABEL[o.rulesStatus] : "—"}</Td>
                      <Td className="text-right">{fmtInt(o.daysObserved)}</Td>
                      <Td className="text-right">{fmtBRL(o.after.spend)}</Td>
                      <Td className="text-right">{fmtInt(o.after.purchases)}</Td>
                      <Td className="text-right">{o.after.cpa != null ? fmtBRL(o.after.cpa) : o.after.spend > 0 ? "sem venda" : "—"}</Td>
                      <Td className="text-right text-muted">{fmtBRL(o.targets.maxCpa)}</Td>
                      <Td className="text-muted">{o.evidence ? EVIDENCE_LABEL[o.evidence] : "—"}</Td>
                      <Td>
                        <OutcomeBadge verdict={o.consultant} />
                      </Td>
                      <Td>{o.rules ? <OutcomeBadge verdict={o.rules} /> : "—"}</Td>
                      <Td>
                        <Link href={`/campanhas/${report.campaignId}#parecer`} className="text-faint hover:text-text" aria-label="Abrir campanha">
                          <ArrowRight className="h-4 w-4" />
                        </Link>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableWrap>
          </Card>
        </>
      )}
    </>
  );
}
