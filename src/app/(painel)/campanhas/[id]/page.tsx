import { AlertOctagon, AlertTriangle, ArrowLeft, CheckCircle2, Film, Gauge, Image as ImageIcon, Info, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { campaignDetail } from "@/lib/analytics";
import { getRepository } from "@/lib/data";
import { env } from "@/lib/env";
import { STATUS_LABEL } from "@/lib/decision/rules";
import { fmtBRL, fmtDate, fmtDec, fmtInt, fmtPct, fmtRoas } from "@/lib/format";
import { periodFrom, withPeriod, type SearchParams } from "@/lib/page";
import { todayIn } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { ChatPanel } from "@/components/advisor/chat-panel";
import { GenerateParecerForm } from "@/components/advisor/generate-form";
import { ParecerView } from "@/components/advisor/parecer-view";
import { AudienceAnalysis } from "@/components/audience-analysis";
import { TimelineChart } from "@/components/charts/timeline-chart";
import { DecisionBadge } from "@/components/decision-badge";
import { PageHeader } from "@/components/layout/page-header";
import { PeriodPicker } from "@/components/layout/period-picker";
import { NoteForm } from "@/components/note-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { Stat } from "@/components/ui/stat";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";

const RANK_LABEL: Record<string, { label: string; tone: "good" | "bad" | "neutral" }> = {
  ABOVE_AVERAGE: { label: "Acima da média", tone: "good" },
  AVERAGE: { label: "Média", tone: "neutral" },
  BELOW_AVERAGE_35: { label: "Abaixo (35% piores)", tone: "bad" },
  BELOW_AVERAGE_20: { label: "Abaixo (20% piores)", tone: "bad" },
  BELOW_AVERAGE_10: { label: "Abaixo (10% piores)", tone: "bad" },
};

// A geração do Parecer (server action desta página) pode levar 1–2 min com esforço "high".
export const maxDuration = 300;

export default async function CampanhaPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const repo = await getRepository();
  const ctx = await repo.context();
  const period = periodFrom(await searchParams, ctx.workspace.timezone);
  const [d, reports] = await Promise.all([campaignDetail(repo, id, period), repo.advisorReports(id, 10)]);
  if (!d) notFound();
  const latest = reports[0] ?? null;
  const periodParams: Record<string, string> = { p: period.key, ...(period.key === "custom" ? { from: period.from, to: period.to } : {}) };
  const hasAi = Boolean(env.anthropicApiKey);
  const { campaign, row, k, funnel, leak } = d;
  const dec = row.decision;
  const maxFunnel = Math.max(1, funnel[0].value);

  // Ranking de criativos: com venda primeiro (menor CPA), depois por CTR
  const ranked = [...d.adPerf].sort((a, b) => {
    if (a.cpaReal != null && b.cpaReal != null) return a.cpaReal - b.cpaReal;
    if (a.cpaReal != null) return -1;
    if (b.cpaReal != null) return 1;
    return (b.derived.ctrLink ?? 0) - (a.derived.ctrLink ?? 0);
  });
  const withSpend = ranked.filter((a) => a.meta.spend > 0);
  const winner = withSpend.find((a) => a.cpaReal != null);
  const loser = [...withSpend].reverse().find((a) => a.meta.spend > (row.product?.targetCpa ?? 50) && (a.cpaReal == null || a.cpaReal > (row.product?.maxCpa ?? Infinity)));

  return (
    <>
      <Link href={withPeriod("/campanhas", period)} className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-text">
        <ArrowLeft className="h-3.5 w-3.5" /> Campanhas
      </Link>
      <PageHeader
        title={<span className="break-all">{campaign.name}</span>}
        description={[
          campaign.effectiveStatus === "ACTIVE" ? "Ativa" : "Pausada",
          campaign.objective?.replace("OUTCOME_", "Objetivo: "),
          campaign.dailyBudget ? `${fmtBRL(campaign.dailyBudget)}/dia (CBO)` : campaign.budgetType === "ABO" ? "Orçamento por conjunto (ABO)" : null,
          row.product ? `Produto: ${row.product.name}` : "Sem produto vinculado (metas padrão)",
          campaign.createdTime ? `Criada em ${fmtDate(campaign.createdTime.slice(0, 10))}` : null,
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          <>
            <ChatPanel campaignId={campaign.id} period={periodParams} enabled={hasAi} />
            <PeriodPicker current={period.key} from={period.from} to={period.to} />
          </>
        }
      />

      {/* -------- Sinais das regras (camada 1) -------- */}
      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-border bg-panel-2/50 px-4 py-3">
          <DecisionBadge status={dec.status} large />
          <span className="text-xs text-muted">Confiança {dec.confidence}</span>
          <span className="ml-auto text-xs text-faint">Veredito das regras · atualizado a cada sincronização</span>
        </div>
        <CardBody>
          <p className="text-base font-medium">
            {STATUS_LABEL[dec.status]}: {dec.headline}
          </p>
          {dec.missingData ? <p className="mt-1 text-sm text-muted">{dec.missingData}</p> : null}
          {dec.signals.length ? (
            <ul className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2">
              {dec.signals.map((s) => {
                const Icon = s.severity === "critico" ? AlertOctagon : s.severity === "atencao" ? AlertTriangle : s.severity === "positivo" ? CheckCircle2 : Info;
                return (
                  <li
                    key={s.code}
                    className={cn(
                      "flex gap-2 rounded-lg border px-3 py-2 text-sm",
                      s.severity === "critico" && "border-bad/30 bg-bad/5",
                      s.severity === "atencao" && "border-warn/30 bg-warn/5",
                      s.severity === "positivo" && "border-good/30 bg-good/5",
                      s.severity === "info" && "border-info/30 bg-info/5",
                    )}
                  >
                    <Icon
                      className={cn(
                        "mt-0.5 h-4 w-4 shrink-0",
                        s.severity === "critico" && "text-bad",
                        s.severity === "atencao" && "text-warn",
                        s.severity === "positivo" && "text-good",
                        s.severity === "info" && "text-info",
                      )}
                    />
                    {s.message}
                  </li>
                );
              })}
            </ul>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
            {[
              ["Hoje", row.w1],
              ["3 dias", row.w3],
              ["7 dias", row.w7],
            ].map(([label, w]) => {
              const win = w as typeof row.w1;
              return (
                <div key={label as string} className="rounded-lg border border-border bg-bg/40 px-3 py-2">
                  <p className="text-faint">{label as string}</p>
                  <p className="tabular">
                    {fmtBRL(win.spend)} · {win.purchases} venda(s)
                  </p>
                  <p className="tabular text-muted">
                    CPA {fmtBRL(win.cpa)} · ROAS {fmtRoas(win.roas)}
                  </p>
                </div>
              );
            })}
            <div className="rounded-lg border border-border bg-bg/40 px-3 py-2">
              <p className="flex items-center gap-1 text-faint">
                <Gauge className="h-3.5 w-3.5" /> Pacing hoje <InfoTip metric="pacing" />
              </p>
              {d.pacing ? (
                <>
                  <p className="tabular">
                    {fmtBRL(d.pacing.spentToday)} de {fmtBRL(d.pacing.dailyBudget)} ({fmtPct(d.pacing.pctOfBudget, 0)})
                  </p>
                  <p className={cn("tabular", d.pacing.projectedEndOfDay != null && d.pacing.projectedEndOfDay > d.pacing.dailyBudget * 1.15 ? "text-warn" : "text-muted")}>
                    Projeção: {fmtBRL(d.pacing.projectedEndOfDay)} · {fmtPct(d.pacing.dayElapsed, 0)} do dia
                  </p>
                </>
              ) : (
                <p className="text-muted">Sem orçamento diário definido</p>
              )}
            </div>
          </div>
        </CardBody>
      </Card>

      {/* -------- Parecer do Consultor (camada 2: IA) -------- */}
      <Card className="mb-5" id="parecer">
        <CardHeader
          title={
            <span className="inline-flex items-center gap-1.5">
              <Sparkles className="h-4 w-4 text-violet" /> Parecer do Consultor
            </span>
          }
          description={
            hasAi
              ? "A IA lê os números e sinais acima e escreve o plano para os próximos 3 a 7 dias. Cada parecer fica salvo para comparar com o que aconteceu depois."
              : "Sem ANTHROPIC_API_KEY: o parecer é montado só com as regras (mais simples). Configure a chave para o parecer completo da IA."
          }
          action={<GenerateParecerForm campaignId={campaign.id} period={periodParams} hasAi={hasAi} label={latest ? "Gerar novo parecer" : "Gerar parecer"} />}
        />
        <CardBody>
          {latest ? (
            <ParecerView report={latest} tz={ctx.workspace.timezone} />
          ) : (
            <p className="text-sm text-muted">Nenhum parecer ainda para esta campanha. Clique em “Gerar parecer”.</p>
          )}
          {reports.length > 1 ? (
            <details className="mt-6 rounded-lg border border-border p-3">
              <summary className="cursor-pointer text-sm font-medium">Pareceres anteriores ({reports.length - 1})</summary>
              <div className="mt-4 space-y-8">
                {reports.slice(1).map((r) => (
                  <div key={r.id} className="border-t border-border pt-4">
                    <ParecerView report={r} tz={ctx.workspace.timezone} />
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Gasto" metric="spend" value={fmtBRL(k.meta.spend)} />
        <Stat label="Receita líquida" metric="netRevenue" value={fmtBRL(k.real.netRevenue)} />
        <Stat label="Lucro" metric="profit" value={fmtBRL(k.profit.profit)} className={k.profit.profit < 0 ? "border-bad/40" : ""} />
        <Stat label="CPA real" metric="cpaReal" value={fmtBRL(k.profit.cpaReal)} sub={`alvo ${fmtBRL(row.product?.targetCpa ?? null)}`} />
        <Stat label="ROAS real" metric="roasReal" value={fmtRoas(k.profit.roasReal)} sub={`Meta ${fmtRoas(k.derived.roasMeta)}`} />
        <Stat label="Vendas pagas" metric="purchases" value={fmtInt(k.real.paidOrders)} sub={`Meta ${fmtInt(k.meta.purchases)}`} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-5">
        {/* -------- Funil -------- */}
        <Card className="xl:col-span-2">
          <CardHeader title="Funil completo" description="Taxa de passagem entre etapas. Meta + Cakto." />
          <CardBody className="space-y-2.5">
            {funnel.map((s) => {
              const isLeak = leak?.key === s.key;
              return (
                <div key={s.key}>
                  <div className="mb-1 flex items-baseline justify-between text-xs">
                    <span className={cn("font-medium", isLeak && "text-bad")}>
                      {s.label} <span className="font-normal text-faint">· {s.source}</span>
                    </span>
                    <span className="tabular">
                      <b>{fmtInt(s.value)}</b>
                      {s.rate != null ? <span className={cn("ml-2", isLeak ? "text-bad" : "text-muted")}>{fmtPct(s.rate, s.rate < 0.1 ? 2 : 1)}</span> : null}
                    </span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-panel-2">
                    <div
                      className={cn("h-full rounded-full", isLeak ? "bg-bad" : s.source === "Cakto" ? "bg-good" : "bg-primary")}
                      style={{ width: `${Math.max(1.5, Math.sqrt(s.value / maxFunnel) * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {leak ? (
              <p className="rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-xs">
                <b className="text-bad">Vazamento principal: {leak.label}.</b> Passagem de {fmtPct(leak.rate, 1)} contra referência de ~{fmtPct(leak.bench, 0)}.
              </p>
            ) : (
              <p className="text-xs text-muted">Nenhuma etapa muito abaixo da referência.</p>
            )}
            <p className="text-[11px] text-faint">Barras em escala raiz quadrada para caber impressões e vendas no mesmo gráfico.</p>
          </CardBody>
        </Card>

        {/* -------- Linha do tempo -------- */}
        <Card className="xl:col-span-3">
          <CardHeader title="Linha do tempo diária" description="Linhas tracejadas: mudanças de orçamento, criativos, aprendizado e suas anotações" />
          <CardBody>
            <TimelineChart data={d.timeline} markers={d.markers} />
          </CardBody>
        </Card>
      </div>

      {/* -------- Análise de públicos (breakdowns) -------- */}
      <Card className="mt-5">
        <CardHeader title="Análise de públicos" description="Onde converte barato e onde queima dinheiro — por idade, gênero, posicionamento, dispositivo, região, horário e dia da semana." />
        {d.highlights.length ? (
          <ul className="space-y-1 border-b border-border px-4 py-3 text-sm">
            {d.highlights.map((h, i) => (
              <li key={i} className="flex gap-2">
                <span className={cn("mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full", /queima|caro/.test(h) ? "bg-bad" : "bg-good")} />
                {h}
              </li>
            ))}
          </ul>
        ) : null}
        {d.hasBreakdowns ? (
          <AudienceAnalysis tables={d.audience} />
        ) : (
          <p className="p-4 text-sm text-muted">Sem detalhamentos ainda. Eles são sincronizados uma vez por dia (últimos 14 dias) — ou clique em “Sincronizar agora” em Conexões.</p>
        )}
      </Card>

      {/* -------- Conjuntos -------- */}
      <Card className="mt-5">
        <CardHeader title="Conjuntos de anúncios" description="Desempenho real (Cakto) por conjunto" />
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Conjunto</Th>
                <Th>Público</Th>
                <Th className="text-right">Gasto</Th>
                <Th className="text-right">Vendas</Th>
                <Th className="text-right">CPA real</Th>
                <Th className="text-right">ROAS real</Th>
                <Th className="text-right">CTR</Th>
                <Th className="text-right">Connect</Th>
                <Th className="text-right">Freq.</Th>
              </tr>
            </thead>
            <tbody>
              {d.adsetPerf
                .sort((a, b) => b.meta.spend - a.meta.spend)
                .map((a) => {
                  const meta = d.adsetMeta.get(a.id);
                  return (
                    <tr key={a.id} className="hover:bg-panel-2/50">
                      <Td className="max-w-64">
                        <span className="block truncate font-medium" title={a.name}>{a.name}</span>
                        <span className="text-xs text-faint">
                          {a.status === "ACTIVE" ? "Ativo" : "Pausado"}
                          {meta?.learningStage === "LEARNING" ? " · em aprendizado" : ""}
                          {meta?.dailyBudget ? ` · ${fmtBRL(meta.dailyBudget)}/dia` : ""}
                        </span>
                      </Td>
                      <Td className="max-w-72 truncate text-xs text-muted" title={meta?.targetingSummary ?? ""}>{meta?.targetingSummary ?? "—"}</Td>
                      <Td className="text-right">{fmtBRL(a.meta.spend)}</Td>
                      <Td className="text-right">{fmtInt(a.realPurchases)}</Td>
                      <Td className="text-right">{fmtBRL(a.cpaReal)}</Td>
                      <Td className="text-right">{fmtRoas(a.roasReal)}</Td>
                      <Td className="text-right">{fmtPct(a.derived.ctrLink, 2)}</Td>
                      <Td className={cn("text-right", a.derived.connectRate != null && a.derived.connectRate < 0.75 && "text-bad")}>{fmtPct(a.derived.connectRate, 0)}</Td>
                      <Td className={cn("text-right", a.derived.frequency != null && a.derived.frequency > 2.5 && "text-warn")}>{fmtDec(a.derived.frequency, 2)}</Td>
                    </tr>
                  );
                })}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      {/* -------- Criativos -------- */}
      <Card className="mt-5">
        <CardHeader
          title="Criativos"
          description={
            <>
              Ranking por CPA real; fadiga = CTR ou hook caiu ≥25% vs. início com frequência ≥2.{" "}
              {winner ? <span className="text-good">Vencedor: {winner.name}. </span> : null}
              {loser ? <span className="text-bad">Pior: {loser.name}.</span> : null}
            </>
          }
        />
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Anúncio</Th>
                <Th className="text-right">Gasto</Th>
                <Th className="text-right">Vendas</Th>
                <Th className="text-right">CPA real</Th>
                <Th className="text-right">ROAS</Th>
                <Th className="text-right">
                  <span className="inline-flex items-center gap-1">CTR <InfoTip metric="ctrLink" /></span>
                </Th>
                <Th className="text-right">
                  <span className="inline-flex items-center gap-1">Hook <InfoTip metric="hookRate" /></span>
                </Th>
                <Th className="text-right">
                  <span className="inline-flex items-center gap-1">Hold <InfoTip metric="holdRate" /></span>
                </Th>
                <Th>Sinais</Th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((a, i) => (
                <tr key={a.id} className="align-top hover:bg-panel-2/50">
                  <Td className="text-faint">{i + 1}</Td>
                  <Td className="max-w-96 whitespace-normal">
                    <div className="flex gap-3">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-panel-2 text-faint">
                        {a.ad.creative?.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={a.ad.creative.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                        ) : a.ad.creative?.format === "video" ? (
                          <Film className="h-5 w-5" />
                        ) : (
                          <ImageIcon className="h-5 w-5" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-medium" title={a.name}>{a.name}</p>
                        {a.ad.creative?.body ? <p className="line-clamp-2 text-xs text-muted">{a.ad.creative.body}</p> : null}
                        <p className="text-[11px] text-faint">
                          {a.ad.creative?.format === "video" ? "Vídeo" : a.ad.creative?.format === "carousel" ? "Carrossel" : "Imagem"}
                          {a.ad.creative?.callToAction ? ` · CTA ${a.ad.creative.callToAction}` : ""}
                          {a.status !== "ACTIVE" ? " · pausado" : ""}
                        </p>
                      </div>
                    </div>
                  </Td>
                  <Td className="text-right">{fmtBRL(a.meta.spend)}</Td>
                  <Td className="text-right">{fmtInt(a.realPurchases)}</Td>
                  <Td className="text-right font-medium">{fmtBRL(a.cpaReal)}</Td>
                  <Td className="text-right">{fmtRoas(a.roasReal)}</Td>
                  <Td className="text-right">{fmtPct(a.derived.ctrLink, 2)}</Td>
                  <Td className="text-right">{fmtPct(a.derived.hookRate, 0)}</Td>
                  <Td className="text-right">{fmtPct(a.derived.holdRate, 0)}</Td>
                  <Td className="whitespace-normal">
                    <div className="flex max-w-56 flex-wrap gap-1">
                      {a === winner ? <Badge tone="good">Vencedor</Badge> : null}
                      {a === loser ? <Badge tone="bad">Queimando verba</Badge> : null}
                      {a.fatigue.fatigued ? <Badge tone="warn" title={a.fatigue.reason ?? ""}>Fadiga: {a.fatigue.reason}</Badge> : null}
                      {a.rankings.quality && RANK_LABEL[a.rankings.quality] ? (
                        <Badge tone={RANK_LABEL[a.rankings.quality].tone}>Qualidade: {RANK_LABEL[a.rankings.quality].label}</Badge>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      {/* -------- Anotações -------- */}
      <Card className="mt-5">
        <CardHeader title="Histórico de ações" description="Anote o que você mudou para comparar com o resultado depois" />
        <CardBody className="space-y-4">
          <NoteForm campaignId={campaign.id} today={todayIn(ctx.workspace.timezone)} disabled={ctx.mode === "demo"} />
          {d.notes.length ? (
            <ul className="divide-y divide-border">
              {d.notes.map((n) => (
                <li key={n.id} className="flex gap-3 py-2 text-sm">
                  <span className="w-24 shrink-0 text-xs text-faint tabular">{fmtDate(n.date)}</span>
                  <span>{n.text}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">Nenhuma anotação ainda.</p>
          )}
        </CardBody>
      </Card>
    </>
  );
}
