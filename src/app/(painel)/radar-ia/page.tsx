import { ArrowRight, Flame, PlaySquare, Radar } from "lucide-react";
import Link from "next/link";
import { after } from "next/server";
import { hasAi } from "@/lib/ai/structured";
import { POLICY_LABEL } from "@/lib/discover/niches";
import { fmtBRL, fmtCompact, fmtDate, fmtDateTime, fmtPct, fmtRelative, fmtRoas } from "@/lib/format";
import { sp, type SearchParams } from "@/lib/page";
import { autoMeasureWorkspace, buildRadarView, getRadarStore, hasYoutube, needsAutoMeasure, type RadarRow } from "@/lib/radar";
import { freeHooksPrompt } from "@/lib/radar/ai";
import { radarTag } from "@/lib/radar/catalog";
import { HOOK_SOURCE_LABEL, type RadarHook } from "@/lib/radar/hooks";
import { QUOTA_PER_SUBNICHE, WINDOW_DAYS } from "@/lib/radar/measure";
import { HOT, ORIGIN_LABEL, type RadarOrigin } from "@/lib/radar/score";
import { ActionButton, ActionForm } from "@/components/action-form";
import { PageHeader } from "@/components/layout/page-header";
import { RadarHistoryChart } from "@/components/radar/history-chart";
import { Badge, type Tone } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { Table, TableWrap, Td, Th } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import {
  addHooksAction,
  addSubnicheAction,
  deleteHookAction,
  deleteSubnicheAction,
  generateHooksAction,
  hooksFromYoutubeAction,
  measureNowAction,
  sendAllNewAction,
  sendHookAction,
  setHookStatusAction,
} from "./actions";

export const metadata = { title: "Radar de Nichos de IA" };
export const maxDuration = 300;

const ORIGIN_TONE: Record<RadarOrigin, Tone> = { youtube: "info", historico: "violet", meta: "primary", catalogo: "neutral", sem_dados: "warn" };
const POLICY_TONE = { baixo: "good", medio: "warn", alto: "bad" } as const;
const HOOK_TONE = { novo: "info", enviado: "good", descartado: "neutral" } as const;

function scoreTone(v: number | null): Tone {
  if (v == null) return "neutral";
  return v >= 65 ? "good" : v >= 45 ? "warn" : "bad";
}

function Growth({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-faint">—</span>;
  return <span className={cn("font-medium tabular", pct >= HOT.minGrowth ? "text-good" : pct <= -0.2 ? "text-bad" : "text-muted")}>{`${pct >= 0 ? "+" : ""}${fmtPct(pct, 0)}`}</span>;
}

/** Minigráfico SVG (sem JS) da demanda diária. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const w = 64;
  const h = 18;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${((i / (values.length - 1)) * w).toFixed(1)},${(h - ((v - min) / span) * (h - 2) - 1).toFixed(1)}`).join(" ");
  const up = values.at(-1)! >= values[0];
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0" aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? "var(--good)" : "var(--bad)"} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function MetaCell({ row }: { row: RadarRow }) {
  const t = row.meta;
  if (!t?.ads.length) return <span className="text-faint">não testado</span>;
  return (
    <span className="text-xs">
      {fmtBRL(t.spend)} · {t.purchases} venda(s)
      {t.roas != null && t.purchases > 0 ? <span className={cn("ml-1 font-medium", t.roas >= 1 ? "text-good" : "text-bad")}>{fmtRoas(t.roas)}</span> : null}
    </span>
  );
}

function HookItem({ h, showSub }: { h: RadarHook; showSub?: string }) {
  return (
    <li className="flex flex-col gap-2 border-b border-border/60 py-2.5 last:border-0 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <p className={cn("text-sm", h.status === "descartado" && "text-faint line-through")}>{h.text}</p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-faint">
          {showSub ? <Badge>{showSub}</Badge> : null}
          <Badge tone={h.source === "youtube" ? "info" : h.source === "ia" ? "violet" : "neutral"}>{HOOK_SOURCE_LABEL[h.source]}</Badge>
          <Badge tone={HOOK_TONE[h.status]}>{h.status === "enviado" ? `enviado ${fmtRelative(h.sentAt)}` : h.status}</Badge>
          {h.reference ? <span className="min-w-0 break-all">{h.reference}</span> : null}
          {h.source === "youtube" ? <span className="text-warn">título real — reescreva com suas palavras</span> : null}
        </p>
      </div>
      <div className="flex shrink-0 flex-wrap items-start gap-1.5">
        {h.status !== "descartado" ? <ActionButton action={sendHookAction.bind(null, h.id)} label={h.status === "enviado" ? "Enviar de novo" : "Enviar para Criativos"} variant={h.status === "novo" ? "primary" : "secondary"} /> : null}
        {h.status === "descartado" ? <ActionButton action={setHookStatusAction.bind(null, h.id, "novo")} label="Restaurar" /> : <ActionButton action={setHookStatusAction.bind(null, h.id, "descartado")} label="Descartar" />}
        <ActionButton action={deleteHookAction.bind(null, h.id)} label="×" />
      </div>
    </li>
  );
}

export default async function RadarIa({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const { store, repo, workspace, mode } = await getRadarStore();
  const view = await buildRadarView(repo, store, workspace);
  const live = mode === "live";
  const yt = hasYoutube();
  if (live && needsAutoMeasure(view.last, workspace.timezone)) {
    const ws = workspace.id;
    const tz = workspace.timezone;
    after(() => autoMeasureWorkspace(ws, tz));
  }

  const hot = view.rows.filter((r) => r.hot);
  const selectedSlug = sp(params, "s") ?? hot[0]?.sub.slug ?? view.rows[0]?.sub.slug;
  const sel = view.rows.find((r) => r.sub.slug === selectedSlug) ?? view.rows[0];
  const nameOf = new Map(view.rows.map((r) => [r.sub.slug, r.sub.name]));
  const hooksBySlug = new Map<string, RadarHook[]>();
  for (const h of view.hooks) hooksBySlug.set(h.slug, [...(hooksBySlug.get(h.slug) ?? []), h]);
  const selHooks = sel ? (hooksBySlug.get(sel.sub.slug) ?? []) : [];
  const newHooks = view.hooks.filter((h) => h.status === "novo");
  const custom = view.rows.filter((r) => r.sub.origin === "usuario");

  return (
    <>
      <PageHeader
        title="Radar de Nichos de IA"
        description={`Demanda medida no YouTube (views/dia dos vídeos dos últimos ${WINDOW_DAYS} dias), crescimento semana a semana, concorrência por canais e o resultado dos seus testes no Meta (etiqueta ia-<subnicho> no nome do anúncio). Cada parte do score mostra de onde veio.`}
        actions={
          <div className="flex flex-wrap items-start gap-3">
            <div className="text-right text-xs text-muted">
              <p>Última medição: {view.last ? fmtDateTime(view.last.measuredAt, workspace.timezone) : "nunca"}</p>
              <p className="text-faint">{view.history.length} dia(s) de histórico · mede sozinho 1×/dia</p>
            </div>
            <ActionButton action={measureNowAction} label="Medir agora" variant="primary" disabled={live && !yt} />
          </div>
        }
      />

      {live && !yt ? (
        <Card className="mb-5 border-warn/40">
          <CardHeader title={<span className="flex items-center gap-2"><PlaySquare className="h-4 w-4 text-bad" /> Falta ligar o YouTube (5 minutos, uma vez só)</span>} description="Sem a chave o radar ainda mostra catálogo e seus testes no Meta, mas não mede demanda." />
          <CardBody>
            <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted">
              <li>No Google Cloud Console, crie (ou escolha) um projeto.</li>
              <li>Em “APIs e serviços → Biblioteca”, ative a <b className="text-text">YouTube Data API v3</b>.</li>
              <li>Em “Credenciais”, crie uma <b className="text-text">chave de API</b> (restrinja à YouTube Data API v3).</li>
              <li>Na Vercel: Settings → Environment Variables → <code className="rounded bg-panel-2 px-1">YOUTUBE_API_KEY</code> = a chave. Depois, Redeploy.</li>
            </ol>
            <p className="mt-3 text-xs text-faint">
              Não cole a chave aqui no chat nem no sistema. Custo: ~{QUOTA_PER_SUBNICHE} unidades por subnicho por medição (cota grátis de 10.000/dia ≈ 5 medições completas por dia).
            </p>
          </CardBody>
        </Card>
      ) : null}

      {hot.length ? (
        <Card className="mb-5 border-good/40">
          <CardHeader
            title={<span className="flex items-center gap-2"><Flame className="h-4 w-4 text-warn" /> Em alta agora</span>}
            description={`Crescimento ≥ ${fmtPct(HOT.minGrowth, 0)} em 7 dias, ${fmtCompact(HOT.minViewsPerDay)}+ views/dia e sem depender de um único vídeo. Também vira alerta (e notificação, se configurada).`}
          />
          <CardBody className="flex flex-wrap gap-2">
            {hot.map((r) => (
              <Link key={r.sub.slug} href={`/radar-ia?s=${r.sub.slug}#detalhe`} className="rounded-lg border border-good/30 bg-good/5 px-3 py-2 text-sm hover:bg-good/10">
                <span className="font-medium">{r.sub.name}</span> <Growth pct={r.growth.pct} /> <span className="text-xs text-muted">· {fmtCompact(r.measure?.viewsPerDay)} views/dia</span>
              </Link>
            ))}
          </CardBody>
        </Card>
      ) : null}

      <Card className="mb-5">
        <CardHeader
          title="Ranking dos subnichos"
          description={`Score 0–100 (indicador para priorizar testes, não previsão de vendas). Meta: últimos 30 dias (${fmtDate(view.metaPeriod.from)} a ${fmtDate(view.metaPeriod.to)}).${view.metaError ? ` Erro ao ler o Meta: ${view.metaError}` : ""}`}
        />
        <TableWrap>
          <Table>
            <thead>
              <tr>
                <Th>#</Th>
                <Th>Subnicho</Th>
                <Th>Score</Th>
                <Th>Demanda (views/dia)</Th>
                <Th>7 dias</Th>
                <Th>Canais</Th>
                <Th>Seus testes no Meta</Th>
                <Th>Política</Th>
                <Th>Ganchos</Th>
              </tr>
            </thead>
            <tbody>
              {view.rows.map((r, i) => {
                const hk = hooksBySlug.get(r.sub.slug) ?? [];
                const active = r.sub.slug === sel?.sub.slug;
                return (
                  <tr key={r.sub.slug} className={cn(active && "bg-primary/5")}>
                    <Td className="text-faint">{i + 1}</Td>
                    <Td className="max-w-[260px] whitespace-normal">
                      <Link href={`/radar-ia?s=${r.sub.slug}#detalhe`} className="font-medium hover:text-primary">
                        {r.sub.name}
                      </Link>
                      {r.hot ? <Flame className="ml-1 inline h-3.5 w-3.5 text-warn" /> : null}
                      <p className="text-[11px] text-faint">
                        {radarTag(r.sub.slug)}
                        {r.sub.origin === "usuario" ? " · criado por você" : ""}
                      </p>
                    </Td>
                    <Td>
                      <Badge tone={scoreTone(r.score.total)} className="text-xs">
                        {r.score.total ?? "—"}
                      </Badge>
                      {r.score.partial ? <span className="ml-1 text-[10px] text-faint">parcial</span> : null}
                    </Td>
                    <Td>
                      <span className="flex items-center gap-2">
                        <span className="tabular">{r.measure ? fmtCompact(r.measure.viewsPerDay) : "—"}</span>
                        <Sparkline values={r.series.slice(-14).map((p) => p.viewsPerDay)} />
                      </span>
                    </Td>
                    <Td>
                      <Growth pct={r.growth.pct} />
                    </Td>
                    <Td className="tabular">{r.measure ? r.measure.channels : "—"}</Td>
                    <Td>
                      <MetaCell row={r} />
                    </Td>
                    <Td>
                      <Badge tone={POLICY_TONE[r.sub.policy.level]}>{r.sub.policy.level}</Badge>
                    </Td>
                    <Td className="text-xs text-muted">
                      {hk.filter((h) => h.status === "novo").length} novo(s) · {hk.filter((h) => h.status === "enviado").length} enviado(s)
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </TableWrap>
      </Card>

      {sel ? (
        <section id="detalhe" className="mb-5 scroll-mt-20 space-y-5">
          <Card>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <Radar className="h-4 w-4 text-primary" /> {sel.sub.name}
                  {sel.hot ? <Badge tone="good">em alta</Badge> : null}
                  <Badge tone={POLICY_TONE[sel.sub.policy.level]}>{POLICY_LABEL[sel.sub.policy.level]}</Badge>
                </span>
              }
              description={`${sel.sub.audience} · ${sel.sub.promise} · busca no YouTube: “${sel.sub.query}”`}
              action={
                <>
                  <code className="rounded bg-panel-2 px-2 py-1 text-xs">{radarTag(sel.sub.slug)}</code>
                  <CopyButton text={radarTag(sel.sub.slug)} label="Copiar etiqueta" />
                </>
              }
            />
            <CardBody className="grid gap-5 lg:grid-cols-2">
              <div>
                <div className="mb-3 flex items-baseline gap-2">
                  <span className="text-3xl font-semibold tabular">{sel.score.total ?? "—"}</span>
                  <span className="text-xs text-muted">de 100{sel.score.partial ? " · parcial (partes sem dado ficam de fora)" : ""}</span>
                </div>
                <ul className="space-y-2.5">
                  {sel.score.components.map((c) => (
                    <li key={c.key} className="text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">
                          {c.inverse ? "−" : "+"} {c.label}
                        </span>
                        <span className="text-xs text-faint">peso {Math.round(c.weight * 100)}%</span>
                        <Badge tone={ORIGIN_TONE[c.origin]}>{ORIGIN_LABEL[c.origin]}</Badge>
                        <span className="ml-auto tabular text-muted">{c.value ?? "—"}</span>
                      </div>
                      {c.value != null ? (
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-panel-2">
                          <div className={cn("h-full", c.inverse ? "bg-warn/70" : "bg-primary/70")} style={{ width: `${c.value}%` }} />
                        </div>
                      ) : null}
                      <p className="mt-1 text-xs text-muted">{c.detail}</p>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="min-w-0 space-y-5">
                <div>
                  <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Demanda diária no YouTube</h3>
                  <RadarHistoryChart data={sel.series} />
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Vídeos que puxam a demanda {sel.measuredDate ? `(${fmtDate(sel.measuredDate)})` : ""}</h3>
                  {sel.measure?.topVideos.length ? (
                    <ul className="space-y-1.5 text-sm">
                      {sel.measure.topVideos.map((v) => (
                        <li key={v.id} className="min-w-0">
                          {v.id.startsWith("demo") ? (
                            <span>{v.title}</span>
                          ) : (
                            <a href={`https://www.youtube.com/watch?v=${v.id}`} target="_blank" rel="noreferrer" className="hover:text-primary">
                              {v.title}
                            </a>
                          )}
                          <span className="block text-xs text-faint">
                            {v.channelTitle} · {fmtCompact(v.viewsPerDay)} views/dia · {fmtCompact(v.views)} views · publicado {fmtDate(v.publishedAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-faint">{sel.measure ? "Nenhum vídeo recente encontrado para a busca." : "Ainda não medido."}</p>
                  )}
                </div>
                <div>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Seus anúncios com a etiqueta</h3>
                  {sel.meta?.ads.length ? (
                    <>
                      <p className="mb-2 text-sm">
                        {fmtBRL(sel.meta.spend)} gastos · CTR {fmtPct(sel.meta.ctr, 2)} · {sel.meta.purchases} venda(s)
                        {sel.meta.salesSource ? ` (${sel.meta.salesSource === "cakto" ? "Cakto" : "pixel do Meta"})` : ""} · CPA {fmtBRL(sel.meta.cpa)} · ROAS {fmtRoas(sel.meta.roas)}
                      </p>
                      <ul className="space-y-1 text-xs text-muted">
                        {sel.meta.ads.slice(0, 8).map((a) => (
                          <li key={a.id} className="truncate">
                            <Link href={`/campanhas/${a.campaignId}`} className="hover:text-primary">
                              {a.name}
                            </Link>{" "}
                            <span className="text-faint">(etiqueta no {a.via})</span>
                          </li>
                        ))}
                      </ul>
                      {sel.meta.fxMissingRows ? <p className="mt-1 text-xs text-warn">{sel.meta.fxMissingRows} dia(s) sem cotação ficaram de fora.</p> : null}
                    </>
                  ) : (
                    <p className="text-xs text-muted">
                      Nenhum anúncio ainda. Coloque <code className="rounded bg-panel-2 px-1">{radarTag(sel.sub.slug)}</code> no nome do anúncio, do conjunto ou da campanha — ou envie
                      um gancho para Criativos: a fila já nomeia o anúncio com o ângulo do subnicho. Os números aparecem depois da próxima sincronização do Meta.
                    </p>
                  )}
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={`Ganchos de “${sel.sub.name}”`}
              description="Enviar para Criativos cria um item na lista de espera do Flow com o ângulo do subnicho (o anúncio sai com a etiqueta e o resultado volta para cá)."
              action={
                <>
                  <ActionButton action={hooksFromYoutubeAction.bind(null, sel.sub.slug)} label="Pegar títulos do YouTube" />
                  <ActionButton action={generateHooksAction.bind(null, sel.sub.slug)} label="Gerar com IA" disabled={!hasAi()} />
                  <CopyButton
                    text={freeHooksPrompt(
                      sel.sub,
                      sel.measure,
                      selHooks.map((h) => h.text),
                    )}
                    label="Copiar prompt (IA grátis)"
                  />
                  {selHooks.some((h) => h.status === "novo") ? <ActionButton action={sendAllNewAction.bind(null, sel.sub.slug)} label="Enviar todos os novos" variant="primary" /> : null}
                </>
              }
            />
            <CardBody className="grid gap-5 lg:grid-cols-[1fr_320px]">
              <div className="min-w-0">
                {selHooks.length ? (
                  <ul>
                    {selHooks.map((h) => (
                      <HookItem key={h.id} h={h} />
                    ))}
                  </ul>
                ) : (
                  <EmptyState title="Nenhum gancho ainda" description="Pegue os títulos dos vídeos em alta como inspiração, gere com IA (ou numa IA grátis) ou escreva os seus." />
                )}
              </div>
              <div className="space-y-5">
                <ActionForm action={addHooksAction} submitLabel="Adicionar ganchos">
                  <input type="hidden" name="slug" value={sel.sub.slug} />
                  <div>
                    <Label htmlFor="hooks-text">Escrever ou colar (um por linha)</Label>
                    <Textarea id="hooks-text" name="text" rows={5} placeholder="Cole aqui a resposta da IA grátis ou escreva seus ganchos" />
                  </div>
                  <div>
                    <Label htmlFor="hooks-source">Origem</Label>
                    <Select id="hooks-source" name="source" defaultValue="manual">
                      <option value="manual">Escrito por mim</option>
                      <option value="ia">Resposta de uma IA</option>
                    </Select>
                  </div>
                </ActionForm>
              </div>
            </CardBody>
          </Card>
        </section>
      ) : null}

      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Banco de ganchos"
            description={`${view.hooks.length} gancho(s) · ${newHooks.length} novo(s) aguardando envio`}
            action={
              <LinkButton href="/criativos" variant="secondary" size="sm">
                Abrir Criativos <ArrowRight className="h-3.5 w-3.5" />
              </LinkButton>
            }
          />
          <CardBody className="max-h-[520px] overflow-y-auto py-1">
            {newHooks.length ? (
              <ul>
                {newHooks.slice(0, 60).map((h) => (
                  <HookItem key={h.id} h={h} showSub={nameOf.get(h.slug) ?? h.slug} />
                ))}
              </ul>
            ) : (
              <EmptyState title="Nenhum gancho novo" description="Escolha um subnicho no ranking para criar ganchos." />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Histórico diário" description="Uma medição por dia (cron diário + ao abrir esta página, se faltar a de hoje). É a base do crescimento semana a semana." />
          {view.history.length ? (
            <TableWrap className="max-h-[520px] overflow-y-auto">
              <Table>
                <thead>
                  <tr>
                    <Th>Dia</Th>
                    <Th>Medidos</Th>
                    <Th>Erros</Th>
                    <Th>Views/dia (soma)</Th>
                    <Th>Maior demanda</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...view.history].reverse().slice(0, 30).map((s) => {
                    const ok = s.items.filter((i) => !i.error);
                    const top = [...ok].sort((a, b) => b.viewsPerDay - a.viewsPerDay)[0];
                    return (
                      <tr key={s.date}>
                        <Td>{fmtDate(s.date)}</Td>
                        <Td className="tabular">{ok.length}</Td>
                        <Td className={cn("tabular", s.items.length - ok.length ? "text-warn" : "text-faint")}>{s.items.length - ok.length}</Td>
                        <Td className="tabular">{fmtCompact(ok.reduce((a, i) => a + i.viewsPerDay, 0))}</Td>
                        <Td className="max-w-[200px] truncate text-xs text-muted">{top ? `${nameOf.get(top.slug) ?? top.slug} (${fmtCompact(top.viewsPerDay)})` : "—"}</Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </TableWrap>
          ) : (
            <EmptyState title="Sem medições ainda" description={yt ? "A primeira medição roda em segundo plano ao abrir esta página (ou clique em Medir agora)." : "Configure a YOUTUBE_API_KEY para começar o histórico."} />
          )}
        </Card>
      </div>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader title="Criar subnicho" description="Entra no ranking e na próxima medição. A etiqueta dos anúncios é gerada a partir do nome." />
          <CardBody>
            <ActionForm action={addSubnicheAction} submitLabel="Criar subnicho">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="sn-name">Nome</Label>
                  <Input id="sn-name" name="name" placeholder="IA para nutricionistas" required />
                </div>
                <div>
                  <Label htmlFor="sn-query">Busca no YouTube</Label>
                  <Input id="sn-query" name="query" placeholder="inteligência artificial para nutricionistas" required />
                </div>
                <div>
                  <Label htmlFor="sn-aud">Público</Label>
                  <Input id="sn-aud" name="audience" placeholder="Nutricionistas" />
                </div>
                <div>
                  <Label htmlFor="sn-prom">Promessa</Label>
                  <Input id="sn-prom" name="promise" placeholder="Montar planos e materiais com IA" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="sn-tmin">Ticket mín. (R$)</Label>
                    <Input id="sn-tmin" name="ticketMin" type="number" min={1} defaultValue={27} />
                  </div>
                  <div>
                    <Label htmlFor="sn-tmax">Ticket máx. (R$)</Label>
                    <Input id="sn-tmax" name="ticketMax" type="number" min={1} defaultValue={197} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="sn-ease">Facilidade (0–100)</Label>
                    <Input id="sn-ease" name="ease" type="number" min={0} max={100} defaultValue={60} />
                  </div>
                  <div>
                    <Label htmlFor="sn-pol">Risco de política</Label>
                    <Select id="sn-pol" name="policy" defaultValue="baixo" className="w-full">
                      <option value="baixo">Baixo</option>
                      <option value="medio">Médio</option>
                      <option value="alto">Alto</option>
                    </Select>
                  </div>
                </div>
              </div>
              <div>
                <Label htmlFor="sn-reason">Motivo do risco (opcional)</Label>
                <Input id="sn-reason" name="policyReason" placeholder="Ex.: saúde — sem promessa de resultado" />
              </div>
            </ActionForm>
            {custom.length ? (
              <ul className="mt-4 space-y-2 border-t border-border pt-3">
                {custom.map((r) => (
                  <li key={r.sub.slug} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      {r.sub.name} <span className="text-xs text-faint">· {radarTag(r.sub.slug)} · “{r.sub.query}”</span>
                    </span>
                    <ActionButton action={deleteSubnicheAction.bind(null, r.sub.slug)} label="Remover" />
                  </li>
                ))}
              </ul>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Como o radar calcula" />
          <CardBody className="space-y-2 text-xs text-muted">
            <p>
              <b className="text-text">Demanda (YouTube, medido):</b> os até 50 vídeos em português mais vistos sobre a busca do subnicho publicados nos últimos {WINDOW_DAYS} dias. Views/dia de cada vídeo = views ÷ idade em dias; a demanda é a soma.
            </p>
            <p>
              <b className="text-text">Crescimento (histórico do radar):</b> demanda da medição mais recente vs. a de ~7 dias antes. Precisa de uma semana de histórico — o radar mede sozinho todo dia.
            </p>
            <p>
              <b className="text-text">Concorrência (YouTube, medido):</b> quantos canais diferentes aparecem entre esses vídeos. Também mostramos quanto os 3 maiores canais concentram.
            </p>
            <p>
              <b className="text-text">Seus testes no Meta (medido):</b> anúncios dos últimos 30 dias com a etiqueta <code>ia-&lt;subnicho&gt;</code> no nome do anúncio, conjunto ou campanha (também vale o formato da fila de Criativos, ex.: <code>iaChatgptIniciantes</code>). Vendas da Cakto quando houver; senão, compras do pixel. Sem venda, só conta depois de gastar 2× o ticket médio.
            </p>
            <p>
              <b className="text-text">Ticket, facilidade e política (catálogo):</b> referências do sistema, não medidas.
            </p>
            <p>
              <b className="text-text">Em alta:</b> crescimento ≥ {fmtPct(HOT.minGrowth, 0)} em 7 dias, {fmtCompact(HOT.minViewsPerDay)}+ views/dia e o maior vídeo com até {fmtPct(HOT.maxTopVideoShare, 0)} da demanda (um viral isolado não é tendência). Vira alerta em Alertas.
            </p>
            <p className="text-faint">YouTube mede interesse do público em aprender o tema — não é a demanda de compra no Meta. Use o radar para escolher o que testar; quem confirma é o teste.</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
