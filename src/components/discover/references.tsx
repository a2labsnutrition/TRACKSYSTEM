import { ExternalLink } from "lucide-react";
import { addReferenceAction, addToCollectionAction, analyzeReferenceAction, deleteReferenceAction } from "@/app/(painel)/descobrir/actions";
import { findNiche, findSubniche, NICHES, type Niche } from "@/lib/discover/niches";
import { daysRunning } from "@/lib/discover/score";
import type { AdReference, SwipeCollection } from "@/lib/discover/types";
import { fmtBRL, fmtDate } from "@/lib/format";
import { ActionButton, ActionForm } from "@/components/action-form";
import { Badge } from "@/components/ui/badge";
import { Input, Label, Select, Textarea } from "@/components/ui/input";

const FORMAT_LABEL: Record<AdReference["format"], string> = { video: "Vídeo", image: "Imagem", carousel: "Carrossel", unknown: "Formato não informado" };

export function sourceLabel(r: AdReference): string {
  if (r.source === "manual") return r.libraryId ? "Biblioteca de Anúncios (link informado por você)" : "Informado por você";
  if (r.source === "ai_estimate") return "Estimativa da IA";
  return `Provedor: ${r.source.slice("provider:".length)}`;
}

/** Formulário de importação manual/assistida. */
export function ReferenceForm({ niche, hasAi }: { niche?: Niche; hasAi: boolean }) {
  return (
    <ActionForm action={addReferenceAction} submitLabel="Salvar referência">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="sourceUrl">Link do anúncio (Biblioteca de Anúncios, post ou página)</Label>
          <Input id="sourceUrl" name="sourceUrl" placeholder="https://www.facebook.com/ads/library/?id=…" />
        </div>
        {niche ? (
          <>
            <input type="hidden" name="nicheSlug" value={niche.slug} />
            <div>
              <Label htmlFor="subnicheSlug">Subnicho</Label>
              <Select id="subnicheSlug" name="subnicheSlug" defaultValue="" className="w-full">
                <option value="">—</option>
                {niche.subniches.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
          </>
        ) : (
          <div>
            <Label htmlFor="nicheSlug">Nicho</Label>
            <Select id="nicheSlug" name="nicheSlug" defaultValue="" className="w-full">
              <option value="">—</option>
              {NICHES.map((n) => (
                <option key={n.slug} value={n.slug}>
                  {n.name}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div>
          <Label htmlFor="advertiser">Anunciante</Label>
          <Input id="advertiser" name="advertiser" placeholder="Nome da página" />
        </div>
        <div>
          <Label htmlFor="format">Formato</Label>
          <Select id="format" name="format" defaultValue="video" className="w-full">
            <option value="video">Vídeo</option>
            <option value="image">Imagem</option>
            <option value="carousel">Carrossel</option>
            <option value="unknown">Não sei</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="firstSeen">No ar desde (data na Biblioteca)</Label>
          <Input id="firstSeen" name="firstSeen" type="date" />
        </div>
        <div>
          <Label htmlFor="variations">Variações do mesmo anúncio</Label>
          <Input id="variations" name="variations" type="number" min={0} placeholder="ex.: 12" />
        </div>
        <div>
          <Label htmlFor="price">Preço do produto (R$)</Label>
          <Input id="price" name="price" inputMode="decimal" placeholder="ex.: 47,00" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="copy">Texto do anúncio</Label>
          <Textarea id="copy" name="copy" rows={4} placeholder="Cole o texto principal / a fala do vídeo" />
        </div>
        <div>
          <Label htmlFor="hook">Gancho (primeira frase/3 segundos)</Label>
          <Input id="hook" name="hook" />
        </div>
        <div>
          <Label htmlFor="angle">Ângulo</Label>
          <Input id="angle" name="angle" placeholder="ex.: renda com doces" />
        </div>
        <div>
          <Label htmlFor="cta">CTA</Label>
          <Input id="cta" name="cta" placeholder="ex.: Saiba mais" />
        </div>
        <div>
          <Label htmlFor="landingType">Tipo de página</Label>
          <Input id="landingType" name="landingType" placeholder="VSL, página curta, quiz…" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="landingUrl">Link da página de destino</Label>
          <Input id="landingUrl" name="landingUrl" placeholder="https://…" />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="notes">Observações</Label>
          <Input id="notes" name="notes" />
        </div>
      </div>
      <label className="flex items-center gap-2 text-xs text-muted">
        <input type="checkbox" name="analyze" value="1" defaultChecked={hasAi} disabled={!hasAi} /> Analisar com IA ao salvar (gancho, promessa, ângulo, CTA)
        {!hasAi ? <span className="text-faint">— configure ANTHROPIC_API_KEY</span> : null}
      </label>
    </ActionForm>
  );
}

export function ReferenceCard({ r, collections, hasAi, today, showNiche = false }: { r: AdReference; collections: SwipeCollection[]; hasAi: boolean; today: string; showNiche?: boolean }) {
  const days = daysRunning(r, today);
  const niche = r.nicheSlug ? findNiche(r.nicheSlug) : undefined;
  const sub = niche ? findSubniche(niche, r.subnicheSlug) : undefined;
  const a = r.analysis;
  return (
    <div className="space-y-2 px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {r.advertiser ?? "Anunciante não informado"}
            {showNiche && niche ? <span className="font-normal text-muted"> · {niche.name}{sub ? ` › ${sub.name}` : ""}</span> : !showNiche && sub ? <span className="font-normal text-muted"> · {sub.name}</span> : null}
          </p>
          <p className="text-[11px] text-faint">
            Origem: {sourceLabel(r)} · coletado em {fmtDate(r.collectedAt)}
          </p>
        </div>
        {r.sourceUrl ? (
          <a href={r.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline">
            Abrir <ExternalLink className="h-3 w-3" />
          </a>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge>{FORMAT_LABEL[r.format]}</Badge>
        {days != null ? <Badge tone={days >= 30 ? "good" : "neutral"}>{days} dia(s) no ar</Badge> : null}
        {r.variations != null ? <Badge tone={r.variations >= 5 ? "good" : "neutral"}>{r.variations} variações</Badge> : null}
        {r.price != null ? <Badge>{fmtBRL(r.price)}</Badge> : null}
        {r.landingType ? <Badge>{r.landingType}</Badge> : null}
        {r.libraryId ? <Badge tone="info">ID {r.libraryId}</Badge> : null}
      </div>
      {r.hook || a?.gancho ? (
        <p className="text-sm">
          <span className="text-xs text-faint">Gancho: </span>
          {a?.gancho ?? r.hook}
        </p>
      ) : null}
      {r.copy ? <p className="line-clamp-3 whitespace-pre-line text-xs text-muted">{r.copy}</p> : null}
      {a ? (
        <div className="rounded-lg border border-violet/30 bg-violet/5 p-3 text-xs">
          <p className="mb-1 font-medium text-violet">Análise da IA {a.analyzedAt ? `· ${fmtDate(a.analyzedAt)}` : ""}</p>
          <p>
            <b>Promessa:</b> {a.promessa}
          </p>
          <p>
            <b>Ângulo:</b> {a.angulo} · <b>CTA:</b> {a.cta} · <b>Página:</b> {a.tipo_pagina}
          </p>
          {a.por_que_funciona.length ? <p className="mt-1"><b>Hipóteses:</b> {a.por_que_funciona.join(" · ")}</p> : null}
          {a.riscos_politica.length ? <p className="mt-1 text-warn"><b>Riscos se copiar:</b> {a.riscos_politica.join(" · ")}</p> : null}
          {a.ideias_para_testar.length ? <p className="mt-1"><b>Ideias para testar:</b> {a.ideias_para_testar.join(" · ")}</p> : null}
        </div>
      ) : r.angle ? (
        <p className="text-xs text-muted">Ângulo (informado): {r.angle}</p>
      ) : null}
      {r.notes ? <p className="text-xs text-faint">{r.notes}</p> : null}
      <div className="flex flex-wrap items-start gap-3">
        {hasAi ? <ActionButton action={analyzeReferenceAction.bind(null, r.id)} label={a ? "Analisar de novo" : "Analisar com IA"} /> : null}
        {collections.length ? (
          <ActionForm action={addToCollectionAction} submitLabel="Adicionar" variant="secondary" className="flex flex-wrap items-start gap-2 space-y-0 [&>fieldset]:flex [&>fieldset]:flex-wrap [&>fieldset]:items-center [&>fieldset]:gap-2 [&>fieldset]:space-y-0">
            <input type="hidden" name="refId" value={r.id} />
            <Select name="collectionId" defaultValue="" className="h-8 text-xs">
              <option value="">Coleção…</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </ActionForm>
        ) : null}
        <ActionButton action={deleteReferenceAction.bind(null, r.id)} label="Remover" />
      </div>
    </div>
  );
}
