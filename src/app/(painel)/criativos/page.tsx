import { Clapperboard, ExternalLink, Film } from "lucide-react";
import { hasAi } from "@/lib/ai/structured";
import { getCreativeStore, learnFromMeta } from "@/lib/creative";
import { manualFlowPrompt } from "@/lib/creative/ai";
import { campaignBrief, manualCampaignPrompt } from "@/lib/creative/campaign-ideas";
import { CREATION_PLATFORMS, flowPromptText, isVideo, type FlowQueueItem } from "@/lib/creative/flow";
import { angleLessons, type LearnedCreative } from "@/lib/creative/learning";
import { CREATIVE_BUCKET, signedUrls } from "@/lib/creative/storage";
import { VERDICT_LABEL } from "@/lib/creative/intelligence";
import { getDiscoverStore } from "@/lib/discover";
import { isServiceRoleConfigured } from "@/lib/env";
import { fmtBRL, fmtDate } from "@/lib/format";
import { sp, type SearchParams } from "@/lib/page";
import { todayIn } from "@/lib/tz";
import { ActionButton, ActionForm } from "@/components/action-form";
import { CopyAndOpen, RenameAsset, Uploader } from "@/components/creative/creative-client";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import {
  addPastedAction,
  buildTodayAction,
  campaignIdeasAction,
  deleteAssetAction,
  deleteQueueItemAction,
  generateScenesAction,
  importFromKitAction,
  pastedIdeasAction,
  setQueueStatusAction,
} from "./actions";

export const metadata = { title: "Criativos" };
export const maxDuration = 300;

const ACTION_TONE = { repetir: "good", testar_mais: "neutral", abandonar: "bad" } as const;
const ACTION_LABEL = { repetir: "Repetir", testar_mais: "Testar mais", abandonar: "Abandonar" } as const;

export default async function Criativos({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const campaignId = sp(params, "campanha") ?? "";
  const ai = hasAi();
  const { store, repo, workspace, mode } = await getCreativeStore();
  const live = mode === "live";
  const today = todayIn(workspace.timezone);
  const [queue, assets, products, kitsStore] = await Promise.all([store.listQueue(), store.listAssets(), repo.products(), getDiscoverStore()]);
  const [kits, campaigns] = await Promise.all([kitsStore.store.listKits(), repo.campaigns()]);
  const brief = campaignId ? await campaignBrief(repo, kitsStore.store, workspace, campaignId).catch(() => null) : null;
  const sortedCampaigns = [...campaigns].sort((a, b) => Number(b.effectiveStatus === "ACTIVE") - Number(a.effectiveStatus === "ACTIVE") || a.name.localeCompare(b.name));
  const kitById = new Map(kits.map((k) => [k.id, k]));

  let learned: LearnedCreative[] = [];
  let unmatched = 0;
  let learnError: string | null = null;
  try {
    ({ learned, unmatched } = await learnFromMeta(repo, store, workspace));
  } catch (e) {
    learnError = (e as Error).message;
  }
  const { lessons } = angleLessons(learned);
  const learnedByAsset = new Map(learned.map((l) => [l.assetId, l]));

  const todo = queue.filter((q) => q.status === "todo").sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor) || b.priority - a.priority);
  const backlog = queue.filter((q) => q.status === "backlog");
  const doneToday = queue.filter((q) => q.status === "done" && q.scheduledFor === today).length;
  const defaultProduct = (q: FlowQueueItem | null) => (q?.kitId ? kitById.get(q.kitId)?.inputs.productName || kitById.get(q.kitId)?.title : null) || products[0]?.name || "produto";

  const urls = live && isServiceRoleConfigured() ? await signedUrls(CREATIVE_BUCKET, assets.map((a) => a.storagePath)).catch(() => new Map<string, string>()) : new Map<string, string>();

  return (
    <>
      <PageHeader
        title="Criativos"
        description="Prompts prontos → você gera na plataforma (Google Flow, Higgsfield…) → envia o arquivo de volta → o sistema dá o nome do anúncio e liga o desempenho ao criativo."
      />

      <Card className="mb-5">
        <CardBody className="space-y-2">
          <p className="text-xs text-muted">
            Sem API pública para gerar com os créditos gratuitos dessas plataformas: o sistema copia o prompt e abre o site — você gera lá e envia o arquivo aqui. Nenhuma integração é
            simulada.
          </p>
          <div className="flex flex-wrap gap-2">
            {CREATION_PLATFORMS.map((p) => (
              <a key={p.id} href={p.url} target="_blank" rel="noopener noreferrer" title={p.note} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-panel-2 px-3 text-xs font-medium hover:bg-border">
                {p.name} <ExternalLink className="h-3 w-3" />
              </a>
            ))}
          </div>
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          <Card>
            <CardHeader
              title="Ideias a partir de uma campanha"
              description="Escolha a campanha em que está trabalhando: o sistema lê o produto, os textos e links dos anúncios e o que já vende ou não, e sugere criativos novos com os prompts prontos."
            />
            <CardBody className="space-y-4">
              <form action="/criativos" className="flex flex-wrap items-center gap-2">
                <Select name="campanha" defaultValue={campaignId} className="min-w-0 flex-1">
                  <option value="">Escolha a campanha…</option>
                  {sortedCampaigns.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.effectiveStatus === "ACTIVE" ? "● " : "○ "}
                      {c.name}
                    </option>
                  ))}
                </Select>
                <button type="submit" className="h-9 rounded-lg border border-border-strong bg-panel-2 px-3 text-sm hover:bg-border">
                  Analisar
                </button>
              </form>
              {campaignId && !brief ? <p className="text-xs text-bad">Campanha não encontrada.</p> : null}
              {brief ? (
                <>
                  <div className="rounded-lg border border-border bg-bg/40 p-3">
                    <p className="mb-1 text-xs font-medium text-muted">O que o sistema identificou</p>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted">
                      {brief.summary.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </div>
                  {ai ? (
                    <ActionForm action={campaignIdeasAction} submitLabel="Gerar ideias com IA">
                      <input type="hidden" name="campaignId" value={brief.campaignId} />
                      <Input name="focus" placeholder="Foco opcional (ex.: depoimentos, bastidores, Black Friday)" />
                    </ActionForm>
                  ) : null}
                  <div className="space-y-2 rounded-lg border border-border p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <CopyButton text={manualCampaignPrompt(brief, null)} label="Copiar prompt (IA grátis)" />
                      <span className="text-xs text-faint">Cole no ChatGPT, Claude.ai ou Gemini e traga a resposta abaixo.</span>
                    </div>
                    <ActionForm action={pastedIdeasAction} submitLabel="Colar ideias na lista de espera" variant="secondary">
                      <Textarea name="text" rows={5} placeholder="Cole aqui a resposta completa da IA" />
                    </ActionForm>
                  </div>
                </>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={`Fila de hoje (${todo.length})`}
              description={`${doneToday} produzido(s) hoje · ${backlog.length} na lista de espera. Os créditos são diários: monte a fila com quantos você consegue gerar hoje.`}
              action={
                <ActionForm action={buildTodayAction} submitLabel="Montar fila de hoje" className="flex items-end gap-2 space-y-0 [&>fieldset]:flex [&>fieldset]:items-end [&>fieldset]:gap-2 [&>fieldset]:space-y-0">
                  <div>
                    <Label htmlFor="capacity">Quantos hoje</Label>
                    <Input id="capacity" name="capacity" type="number" min={1} max={50} defaultValue={5} className="h-8 w-20" />
                  </div>
                </ActionForm>
              }
            />
            {todo.length ? (
              <ul className="divide-y divide-border">
                {todo.map((q) => (
                  <li key={q.id} className="space-y-2 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{q.title}</span>
                      <Badge>{q.angle}</Badge>
                      <Badge>{q.ratio}</Badge>
                      {q.durationS ? <Badge>{q.durationS}s</Badge> : null}
                      <Badge tone={q.variant === "B" ? "violet" : "primary"}>versão {q.variant}</Badge>
                      {q.scheduledFor < today ? <Badge tone="warn">atrasado desde {fmtDate(q.scheduledFor)}</Badge> : null}
                      {q.kitId && kitById.get(q.kitId) ? <span className="text-[11px] text-faint">kit: {kitById.get(q.kitId)!.title}</span> : null}
                    </div>
                    {q.hook ? <p className="text-xs text-muted">Gancho: {q.hook}</p> : null}
                    <pre className="whitespace-pre-wrap rounded-lg bg-panel-2 p-2 font-mono text-[11px] text-muted">{flowPromptText(q)}</pre>
                    <div className="flex flex-wrap items-center gap-2">
                      <CopyAndOpen text={flowPromptText(q)} />
                      <ActionButton action={setQueueStatusAction.bind(null, q.id, "skipped")} label="Pular" />
                      <ActionButton action={setQueueStatusAction.bind(null, q.id, "backlog")} label="Para depois" />
                    </div>
                    <Uploader queueId={q.id} kitId={q.kitId} angle={q.angle} hook={q.hook} defaultProduct={defaultProduct(q)} live={live} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState
                icon={<Clapperboard className="h-6 w-6" />}
                title="Nada na fila de hoje"
                description={backlog.length ? "Clique em “Montar fila de hoje” para puxar os prompts de maior potencial da lista de espera." : "Adicione prompts de um kit ou cole os seus (ao lado)."}
              />
            )}
          </Card>

          <Card>
            <CardHeader
              title="Ciclo de aprendizado"
              description="Cada criativo enviado é ligado ao anúncio do Meta pelo nome e avaliado com o mesmo teste estatístico da campanha (últimos 30 dias). Gasto alto não é prova de que vende."
            />
            <CardBody className="space-y-4">
              {learnError ? <p className="text-xs text-bad">Não deu para ler o desempenho: {learnError}</p> : null}
              {lessons.length ? (
                <ul className="space-y-2">
                  {lessons.map((l) => (
                    <li key={l.angle} className="rounded-lg border border-border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{l.angle}</span>
                        <Badge tone={ACTION_TONE[l.action]}>{ACTION_LABEL[l.action]}</Badge>
                        <span className="text-xs text-faint">{l.creatives} criativo(s)</span>
                      </div>
                      <p className="mt-1 text-xs text-muted">{l.why}</p>
                      {l.hooks.length ? <p className="mt-1 text-xs">Ganchos que foram bem: {l.hooks.join(" · ")}</p> : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-muted">
                  Ainda sem criativos enviados ligados a anúncios com dados. Ao subir no Meta, use exatamente o nome que o sistema gerou para cada arquivo.
                  {unmatched ? ` ${unmatched} criativo(s) ainda sem anúncio com esse nome no Meta (sincroniza a cada hora).` : ""}
                </p>
              )}
              <div className="space-y-3 rounded-lg border border-border p-3">
                <p className="text-sm font-medium">Prompts para amanhã a partir do aprendizado</p>
                {ai ? (
                  <ActionForm action={generateScenesAction} submitLabel="Gerar cenas com IA">
                    <Input name="focus" placeholder="Foco opcional (ex.: Dia das Mães, depoimento, bastidores)" />
                  </ActionForm>
                ) : null}
                <div className="flex flex-wrap items-center gap-2">
                  <CopyButton text={manualFlowPrompt(lessons, null)} label="Copiar prompt (IA grátis)" />
                  <span className="text-xs text-faint">Cole no ChatGPT, Claude.ai ou Gemini e traga a resposta em “Colar prompts”.</span>
                </div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`Biblioteca de criativos (${assets.length})`} description="Arquivos enviados, com o nome do anúncio para usar no Meta e o resultado quando houver." />
            {assets.length ? (
              <ul className="grid gap-3 p-4 sm:grid-cols-2">
                {assets.map((a) => {
                  const url = urls.get(a.storagePath);
                  const l = learnedByAsset.get(a.id);
                  return (
                    <li key={a.id} className="min-w-0 space-y-2 rounded-lg border border-border p-3">
                      {url ? (
                        isVideo(a.storagePath) ? (
                          <video src={url} controls preload="metadata" className="aspect-[9/16] max-h-72 w-full rounded-md bg-black object-contain" />
                        ) : (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt={a.adName ?? "criativo"} className="max-h-72 w-full rounded-md bg-black object-contain" />
                        )
                      ) : (
                        <div className="flex h-24 items-center justify-center rounded-md bg-panel-2 text-xs text-faint">
                          <Film className="mr-1 h-4 w-4" /> {live ? "prévia indisponível" : "exemplo fictício"}
                        </div>
                      )}
                      <RenameAsset id={a.id} name={a.adName ?? ""} />
                      <div className="flex flex-wrap items-center gap-1.5">
                        <CopyButton text={a.adName ?? ""} label="Copiar nome" />
                        {a.angle ? <Badge>{a.angle}</Badge> : null}
                        {a.metaAdId ? <Badge tone="info">ligado ao anúncio</Badge> : <Badge tone="warn">sem anúncio no Meta</Badge>}
                        {l ? <Badge tone={l.verdict === "destaque_comprovado" ? "good" : l.verdict === "abaixo_comprovado" || l.verdict === "gasto_sem_venda" ? "bad" : "neutral"}>{VERDICT_LABEL[l.verdict]}</Badge> : null}
                      </div>
                      {l ? (
                        <p className="text-[11px] text-muted">
                          {l.campaignName} · gasto {fmtBRL(l.spend)} · {l.purchases} venda(s)
                        </p>
                      ) : null}
                      <p className="text-[11px] text-faint">Enviado em {fmtDate(a.createdAt)}</p>
                      <ActionButton action={deleteAssetAction.bind(null, a.id)} label="Remover" />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState title="Nenhum criativo enviado" description="Gere na plataforma e envie pela fila de hoje (ou pelo envio avulso ao lado)." />
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Adicionar do kit" description="Puxa os prompts de cena dos roteiros do kit (com versão B para teste A/B)." />
            <CardBody>
              {kits.length ? (
                <ActionForm action={importFromKitAction} submitLabel="Adicionar à lista de espera">
                  <Select name="kitId" defaultValue={kits[0].id} className="w-full">
                    {kits.map((k) => (
                      <option key={k.id} value={k.id}>
                        {k.title}
                      </option>
                    ))}
                  </Select>
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <input type="checkbox" name="withB" value="1" defaultChecked /> Criar versão B de cada cena
                  </label>
                </ActionForm>
              ) : (
                <p className="text-xs text-muted">Nenhum kit ainda. Crie em Descobrir & Criar.</p>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Colar prompts" description="Um prompt por parágrafo (ou por item de lista). Serve para a resposta da IA grátis." />
            <CardBody>
              <ActionForm action={addPastedAction} submitLabel="Adicionar à lista de espera">
                <Textarea name="text" rows={6} placeholder="Vertical video, woman in a small kitchen..." />
                <div className="grid grid-cols-2 gap-2">
                  <Input name="angle" placeholder="Ângulo" />
                  <Select name="ratio" defaultValue="9:16">
                    <option value="9:16">9:16</option>
                    <option value="4:5">4:5</option>
                    <option value="1:1">1:1</option>
                    <option value="16:9">16:9</option>
                  </Select>
                </div>
              </ActionForm>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Envio avulso" description="Um criativo que não veio da fila." />
            <CardBody>
              <Uploader queueId={null} kitId={null} angle="" hook={null} defaultProduct={defaultProduct(null)} live={live} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`Lista de espera (${backlog.length})`} description="Ordenada pela prioridade: ângulos que vendem sobem." />
            {backlog.length ? (
              <ul className="divide-y divide-border">
                {backlog.slice(0, 30).map((q) => (
                  <li key={q.id} className="flex items-start justify-between gap-2 px-4 py-2 text-xs">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{q.title}</span>
                      <span className="text-faint">
                        {q.angle} · {q.ratio} · versão {q.variant}
                      </span>
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <ActionButton action={setQueueStatusAction.bind(null, q.id, "todo")} label="Hoje" />
                      <ActionButton action={deleteQueueItemAction.bind(null, q.id)} label="×" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-xs text-muted">Vazia.</p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
