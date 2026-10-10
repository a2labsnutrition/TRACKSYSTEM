import { AlertOctagon, AlertTriangle, ArrowLeft, CheckCircle2, Film, Gauge, Image as ImageIcon, Info, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { campaignDetail } from "@/lib/analytics";
import { getRepository } from "@/lib/data";
import { env } from "@/lib/env";
import { STATUS_LABEL } from "@/lib/decision/rules";
import { VERDICT_LABEL, type CreativeVerdict } from "@/lib/creative/intelligence";
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
import { AttributionSplitView } from "@/components/intel/attribution-split";
import { ConfidencePanel } from "@/components/intel/confidence-panel";
import { FinancialBreakdown } from "@/components/intel/financial-breakdown";
import { RecommendationCard } from "@/components/intel/recommendation-card";
import type { Tone } from "@/components/ui/badge";

const VERDICT_TONE: Record<CreativeVerdict, Tone> = {
  destaque_comprovado: "good",
  sinal_positivo: "info",
  abaixo_comprovado: "bad",
  gasto_sem_venda: "bad",
  inconclusivo: "neutral",
  pouco_gasto: "neutral",
};

const BREAKEVEN_SOURCE: Record<string, string> = {
  produto: "equilíbrio do produto (preço − taxas − impostos − custos)",
  configurado: "definido por você no produto",
  medido: "equilíbrio medido nas vendas (sem produto vinculado)",
  padrao: "valor padrão — vincule o produto",
};

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

  const creatives = [...d.creatives.ads].sort((a, b) => b.meta.spend - a.meta.spend);
  const up = d.finWithPool;
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
          <span className="ml-auto text-xs text-faint">Diagnóstico do motor · consultivo: nada é alterado na sua conta</span>
        </div>
        <CardBody>
          <p className="text-base font-medium">
            {STATUS_LABEL[dec.status]}: {dec.headline}
          </p>
          {dec.missingData ? <p className="mt-1 text-sm text-muted">{dec.missingData}</p> : null}
          {campaign.effectiveStatus === "ACTIVE" ? (
            <p className="mt-2 text-xs text-muted">
              {dec.cpa.purchases > 0 ? (
                <>
                  CPA 7 dias {fmtBRL(dec.cpa.point)} · intervalo de 95%: {fmtBRL(dec.cpa.lower)} a {dec.cpa.upper == null ? "∞" : fmtBRL(dec.cpa.upper)} ({dec.cpa.purchases} compra(s) com origem)
                </>
              ) : (
                <>Nenhuma compra com origem nesta campanha nos últimos 7 dias</>
              )}{" "}
              · CPA máximo {fmtBRL(dec.limitCpa)}{" "}
              <span className="text-faint">({BREAKEVEN_SOURCE[row.config.breakevenSource ?? "padrao"]})</span> · {row.daysActive} dia(s) com gasto nos últimos 7 · fuso {row.timezone}
            </p>
          ) : null}
          <div className="mt-3">
            <ConfidencePanel a={dec.confidenceDetail} />
          </div>
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
                    {fmtBRL(win.spend)} · {win.purchases} compra(s)
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
          {dec.recommendations.length ? (
            <div className="mt-4 space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted">Recomendações (por prioridade)</p>
              {dec.recommendations.map((r, i) => (
                <RecommendationCard key={`${r.action}-${i}`} rec={r} />
              ))}
            </div>
          ) : null}
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

      {up ? (
        <p className="mb-3 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
          {k.fin.mainPurchases === 0 ? "Resultado indeterminado: nenhuma compra com origem nesta campanha, mas há" : "Há"} {d.unattributedPool} compra(s) sem origem no
          período que podem ser desta campanha. Cada número abaixo mostra o intervalo entre “só vendas com origem” e “se todas as vendas sem origem fossem daqui” — o
          real está entre os dois.
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Gasto" metric="spend" value={fmtBRL(k.meta.spend)} sub={k.fx.estimated ? "câmbio estimado" : undefined} />
        <Stat
          label="Faturamento bruto"
          metric="grossRevenue"
          value={up ? <RangeValue a={fmtBRL(k.fin.grossApproved)} b={fmtBRL(up.grossApproved)} /> : fmtBRL(k.fin.grossApproved)}
          sub="vendas com origem nesta campanha"
        />
        <Stat
          label="Lucro de contribuição"
          metric="profit"
          value={up ? <RangeValue a={fmtBRL(k.fin.contribution)} b={fmtBRL(up.contribution)} /> : fmtBRL(k.fin.contribution)}
          sub="estimado"
          className={!up && k.fin.contribution < 0 ? "border-bad/40" : ""}
        />
        <Stat
          label="CPA"
          metric="cpaReal"
          value={up ? <RangeValue a={fmtBRL(up.cpa)} b={k.fin.cpa == null ? "indefinido" : fmtBRL(k.fin.cpa)} /> : fmtBRL(k.fin.cpa)}
          sub={`máximo ${fmtBRL(row.config.maxCpa)}`}
        />
        <Stat
          label="ROAS bruto"
          metric="roasReal"
          value={up ? <RangeValue a={fmtRoas(k.fin.roasGross)} b={fmtRoas(up.roasGross)} /> : fmtRoas(k.fin.roasGross)}
          sub={`Meta ${fmtRoas(k.derived.roasMeta)}`}
        />
        <Stat
          label="Compras (principal)"
          metric="purchases"
          value={fmtInt(k.fin.mainPurchases)}
          sub={up ? `+${d.unattributedPool} sem origem · Meta ${fmtInt(k.meta.purchases)}` : `Meta ${fmtInt(k.meta.purchases)}`}
        />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Resultado financeiro da campanha" description="Só vendas com origem nesta campanha (confirmada ou provável)" />
          <CardBody>
            <FinancialBreakdown fin={k.fin} spendEstimated={k.fx.estimated} undetermined={Boolean(up)} />
            {up ? (
              <p className="mt-3 rounded-lg border border-border bg-bg/40 px-3 py-2 text-xs text-muted">
                <b className="text-text">Cenário-limite</b> (se as {d.unattributedPool} compra(s) sem origem fossem desta campanha): faturamento {fmtBRL(up.grossApproved)}, lucro de
                contribuição {fmtBRL(up.contribution)}, CPA {fmtBRL(up.cpa)}, ROAS {fmtRoas(up.roasGross)}. Não é uma estimativa do resultado — é o limite superior.
              </p>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Origem das vendas" description="Confirmada × provável × desconhecida — e o número do Meta à parte" />
          <CardBody className="space-y-3">
            <AttributionSplitView split={k.attribution} metaPurchases={k.meta.purchases} />
            {d.unattributedPool > 0 ? (
              <p className="rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
                {d.unattributedPool} compra(s) no período ({fmtBRL(d.unattributedRevenue)} de faturamento) sem campanha identificada. Podem ter vindo desta campanha, mas não entram no CPA dela — nem no de nenhum criativo.
              </p>
            ) : null}
          </CardBody>
        </Card>
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
        <CardHeader title="Conjuntos de anúncios" description="Compras principais com origem no conjunto (Cakto); métricas de mídia do Meta" />
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Conjunto</Th>
                <Th>Público</Th>
                <Th className="text-right">Gasto</Th>
                <Th className="text-right">Compras</Th>
                <Th className="text-right">CPA</Th>
                <Th className="text-right">ROAS bruto</Th>
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
          title="Inteligência de criativos"
          description="Gasto alto = previsão do algoritmo do Meta, não prova de venda. “Comprovado” só com teste estatístico contra o restante da campanha."
        />
        {d.creatives.notes.length || d.creatives.tests.length ? (
          <div className="grid grid-cols-1 gap-3 border-b border-border px-4 py-3 text-sm md:grid-cols-2">
            <ul className="space-y-1">
              {d.creatives.notes.map((n, i) => (
                <li key={i} className="flex gap-2 text-xs text-muted">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" /> {n}
                </li>
              ))}
            </ul>
            <ul className="space-y-1.5">
              {d.creatives.tests.map((t, i) => (
                <li key={i} className="rounded-lg border border-violet/30 bg-violet/5 px-3 py-2 text-xs">
                  <b className="text-violet">{t.title}.</b> <span className="text-muted">{t.detail}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>Anúncio</Th>
                <Th>Leitura</Th>
                <Th className="text-right">Gasto</Th>
                <Th className="text-right">Compras</Th>
                <Th className="text-right">CPA (IC 95%)</Th>
                <Th className="text-right">ROAS</Th>
                <Th className="text-right">
                  <span className="inline-flex items-center gap-1">CTR <InfoTip metric="ctrLink" /></span>
                </Th>
                <Th className="text-right">CPC</Th>
                <Th className="text-right">Custo/checkout</Th>
                <Th className="text-right">
                  <span className="inline-flex items-center gap-1">Hook <InfoTip metric="hookRate" /></span>
                </Th>
                <Th className="text-right">
                  <span className="inline-flex items-center gap-1">Retenção <InfoTip metric="holdRate" /></span>
                </Th>
                <Th className="text-right">Freq.</Th>
              </tr>
            </thead>
            <tbody>
              {creatives.map((a) => {
                const ad = d.adPerf.find((x) => x.id === a.id);
                return (
                  <tr key={a.id} className="align-top hover:bg-panel-2/50">
                    <Td className="max-w-80 whitespace-normal">
                      <div className="flex gap-3">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-panel-2 text-faint">
                          {ad?.ad.creative?.thumbnailUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={ad.ad.creative.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                          ) : ad?.ad.creative?.format === "video" ? (
                            <Film className="h-5 w-5" />
                          ) : (
                            <ImageIcon className="h-5 w-5" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-medium" title={a.name}>{a.name}</p>
                          {ad?.ad.creative?.body ? <p className="line-clamp-2 text-xs text-muted">{ad.ad.creative.body}</p> : null}
                          <p className="text-[11px] text-faint">
                            {ad?.ad.creative?.format === "video" ? "Vídeo" : ad?.ad.creative?.format === "carousel" ? "Carrossel" : "Imagem"}
                            {a.status !== "ACTIVE" ? " · pausado" : ""}
                            {ad?.rankings.quality && RANK_LABEL[ad.rankings.quality] ? ` · qualidade: ${RANK_LABEL[ad.rankings.quality].label}` : ""}
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td className="min-w-64 whitespace-normal">
                      <div className="flex flex-wrap gap-1">
                        <Badge tone={VERDICT_TONE[a.verdict]}>{VERDICT_LABEL[a.verdict]}</Badge>
                        {a.fatigue?.fatigued ? <Badge tone="warn">Fadiga</Badge> : null}
                      </div>
                      <ul className="mt-1 space-y-0.5 text-[11px] text-muted">
                        {a.reasons.map((r, i) => (
                          <li key={i}>{r}</li>
                        ))}
                      </ul>
                      {a.distributionNote ? <p className="mt-1 text-[11px] text-warn">{a.distributionNote}</p> : null}
                    </Td>
                    <Td className="text-right">
                      {fmtBRL(a.meta.spend)}
                      <span className="block text-[11px] text-faint">{fmtPct(a.spendShare, 0)} do gasto</span>
                    </Td>
                    <Td className="text-right">
                      {fmtInt(a.purchases)}
                      {a.confirmed ? <span className="block text-[11px] text-faint">{a.confirmed} confirmada(s)</span> : null}
                    </Td>
                    <Td className="text-right">
                      <span className="font-medium">{fmtBRL(a.cpa)}</span>
                      {a.purchases > 0 ? (
                        <span className="block text-[11px] text-faint">
                          {fmtBRL(a.cpaLower)}–{a.cpaUpper == null ? "∞" : fmtBRL(a.cpaUpper)}
                        </span>
                      ) : null}
                    </Td>
                    <Td className="text-right">{fmtRoas(a.roas)}</Td>
                    <Td className={cn("text-right", a.ctrVsRest === "maior" && "text-good", a.ctrVsRest === "menor" && "text-bad")}>{fmtPct(a.derived.ctrLink, 2)}</Td>
                    <Td className="text-right">{fmtBRL(a.derived.cpcLink)}</Td>
                    <Td className="text-right">{fmtBRL(a.derived.costPerCheckout)}</Td>
                    <Td className="text-right">{fmtPct(a.derived.hookRate, 0)}</Td>
                    <Td className="text-right">
                      {a.retention ? (
                        <span title={`25%: ${fmtPct(a.retention.p25, 0)} · 50%: ${fmtPct(a.retention.p50, 0)} · 75%: ${fmtPct(a.retention.p75, 0)} · 100%: ${fmtPct(a.retention.p100, 0)} (das views de 3s)`}>
                          {fmtPct(a.derived.holdRate, 0)}
                          <span className="block text-[11px] text-faint">50%: {fmtPct(a.retention.p50, 0)}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </Td>
                    <Td className="text-right">{fmtDec(a.derived.frequency, 1)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
        <p className="px-4 py-2 text-[11px] text-faint">{d.creatives.method}</p>
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

function RangeValue({ a, b }: { a: string; b: string }) {
  return (
    <span className="block text-lg leading-tight sm:text-xl">
      {a}
      <span className="block text-xs font-medium text-muted">até {b}</span>
    </span>
  );
}
