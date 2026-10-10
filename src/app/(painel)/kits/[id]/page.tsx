import { ArrowLeft, Download, ExternalLink, Rocket } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasAi } from "@/lib/ai/structured";
import { loadKitView, pickSection } from "@/lib/discover/kit-view";
import { lovableUrl } from "@/lib/discover/lovable";
import { sectionToMarkdown } from "@/lib/discover/markdown";
import { findNiche, findSubniche } from "@/lib/discover/niches";
import { adsManagerSteps, buildCampaignStructure } from "@/lib/discover/structure";
import { SECTION_LABEL, SECTION_ORDER, type KitSectionKind } from "@/lib/discover/types";
import { fmtDateTime } from "@/lib/format";
import { sp, type SearchParams } from "@/lib/page";
import { todayIn } from "@/lib/tz";
import { ActionButton, ActionForm } from "@/components/action-form";
import { KitRunner, SectionGenerate } from "@/components/discover/kit-runner";
import { Markdown } from "@/components/discover/markdown";
import { SectionEditor } from "@/components/discover/section-editor";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Input, Label, Textarea } from "@/components/ui/input";
import { deleteKitAction, launchToTrackingAction, updateKitInputsAction } from "../actions";

export const maxDuration = 300;
export const metadata = { title: "Kit de campanha" };

const AI_KINDS: KitSectionKind[] = ["plan", "offer", "landing", "vsl", "scripts"];
const NEEDS_PLAN: KitSectionKind[] = ["offer", "landing", "vsl", "scripts"];

export default async function KitPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const q = await searchParams;
  const versions: Partial<Record<KitSectionKind, number>> = {};
  for (const k of SECTION_ORDER) {
    const v = Number(sp(q, `v_${k}`));
    if (v > 0) versions[k] = v;
  }
  const view = await loadKitView(id, versions);
  if (!view) notFound();
  const { kit, sections, workspace, site, trackingSnippet, landing, lovablePrompt, mode } = view;
  const ai = hasAi();
  const niche = findNiche(kit.nicheSlug);
  const sub = niche ? findSubniche(niche, kit.subnicheSlug) : undefined;
  const existing = SECTION_ORDER.filter((k) => sections.some((s) => s.kind === k));
  const hasPlan = existing.includes("plan");

  const structure = buildCampaignStructure({
    productName: view.productName,
    price: kit.inputs.price ?? null,
    maxCpa: kit.inputs.maxCpa ?? null,
    feeRate: workspace.defaultFeeRate,
    taxRate: workspace.taxRate,
    dailyBudget: kit.inputs.dailyBudget ?? null,
    angles: [],
    date: todayIn(workspace.timezone),
  });
  const structureSection = pickSection(sections, "structure", versions.structure);
  const steps = adsManagerSteps(
    structureSection?.format === "structured" ? (structureSection.data as typeof structure) : structure,
    { pageUrl: site?.domain ? `https://${site.domain.replace(/^https?:\/\//, "")}` : null, pixelId: site?.pixelId ?? null },
  );

  return (
    <>
      <Link href="/kits" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-text">
        <ArrowLeft className="h-3.5 w-3.5" /> Kits
      </Link>
      <PageHeader
        title={kit.title}
        description={
          <>
            {niche ? <Link href={`/descobrir/${niche.slug}`} className="hover:underline">{niche.name}</Link> : kit.nicheSlug}
            {sub ? ` › ${sub.name}` : ""} · {kit.referenceIds.length} referência(s) de inspiração
          </>
        }
        actions={<ActionButton action={deleteKitAction.bind(null, kit.id)} label="Excluir kit" />}
      />

      <Card className="mb-5">
        <CardBody>
          <KitRunner kitId={kit.id} existing={existing} hasAi={ai} autoStart={sp(q, "criar") === "1"} />
        </CardBody>
      </Card>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          {SECTION_ORDER.map((kind) => {
            const all = sections.filter((s) => s.kind === kind).sort((a, b) => b.version - a.version);
            const cur = pickSection(sections, kind, versions[kind]);
            const needsAi = AI_KINDS.includes(kind) && !ai;
            const needsPlan = NEEDS_PLAN.includes(kind) && !hasPlan;
            const md = cur ? sectionToMarkdown(kind, cur) : "";
            return (
              <Card key={kind} id={`sec-${kind}`}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {SECTION_LABEL[kind]}
                      {cur ? <Badge tone="primary">v{cur.version}</Badge> : <Badge>pendente</Badge>}
                      {cur?.format === "markdown" ? <Badge tone="violet">editado</Badge> : null}
                    </span>
                  }
                  description={cur ? `${cur.note ?? ""} · ${fmtDateTime(cur.createdAt, workspace.timezone)}` : undefined}
                  action={
                    <SectionGenerate
                      kitId={kit.id}
                      kind={kind}
                      exists={Boolean(cur)}
                      disabled={needsAi || needsPlan}
                      disabledReason={needsAi ? "Configure ANTHROPIC_API_KEY" : "Gere o plano de ataque primeiro"}
                    />
                  }
                />
                {all.length > 1 ? (
                  <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-2 text-xs text-muted">
                    Versões:
                    {all.map((s) => (
                      <Link
                        key={s.version}
                        href={`/kits/${kit.id}?v_${kind}=${s.version}#sec-${kind}`}
                        className={s.version === cur?.version ? "rounded border border-primary/40 px-1.5 text-primary" : "rounded border border-border px-1.5 hover:text-text"}
                        scroll={false}
                      >
                        v{s.version}
                      </Link>
                    ))}
                  </div>
                ) : null}
                <CardBody>
                  {cur ? (
                    <SectionEditor kitId={kit.id} kind={kind} markdown={md}>
                      {kind === "landing" && lovablePrompt ? (
                        <div className="mb-4 rounded-lg border border-primary/30 bg-primary/5 p-3">
                          <p className="mb-2 text-sm font-medium">Publicar a página</p>
                          <div className="flex flex-wrap gap-2">
                            <a href={lovableUrl(lovablePrompt)} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "sm" })}>
                              Abrir no Lovable <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                            <CopyButton text={lovablePrompt} label="Copiar prompt" />
                            <a href={`/api/kits/${kit.id}/landing${landing ? `?v=${landing.version}` : ""}`} className={buttonVariants({ size: "sm", variant: "secondary" })}>
                              <Download className="h-3.5 w-3.5" /> Baixar HTML
                            </a>
                          </div>
                          <p className="mt-2 text-xs text-muted">
                            O Lovable abre com o prompt preenchido — clique em enviar lá. O prompt já pede o script de tracking no &lt;head&gt; e os botões como links do checkout
                            com data-track=&quot;checkout&quot;.
                            {!trackingSnippet ? " Cadastre o site em Conexões para incluir o script automaticamente." : ""}
                            {!kit.inputs.checkoutUrl ? " Informe o link do checkout em Dados do produto." : ""}
                          </p>
                        </div>
                      ) : null}
                      <Markdown text={md} />
                    </SectionEditor>
                  ) : (
                    <SectionEditor kitId={kit.id} kind={kind} markdown="">
                      <p className="text-sm text-muted">
                        {needsAi
                          ? "Configure ANTHROPIC_API_KEY na Vercel para gerar esta seção com IA — ou escreva manualmente."
                          : needsPlan
                            ? "Gere o plano de ataque primeiro — esta seção parte dele (ou escreva manualmente)."
                            : kind === "compliance"
                              ? "Gere a oferta, a página, a VSL ou os roteiros e depois verifique."
                              : "Ainda não gerada."}
                      </p>
                    </SectionEditor>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Dados do produto" description="Usados pela IA, pela estrutura da campanha e pelo prompt do Lovable." />
            <CardBody>
              <ActionForm action={updateKitInputsAction} submitLabel="Salvar">
                <input type="hidden" name="kitId" value={kit.id} />
                <div>
                  <Label htmlFor="i-title">Nome do kit</Label>
                  <Input id="i-title" name="title" defaultValue={kit.title} />
                </div>
                <div>
                  <Label htmlFor="i-name">Nome do produto</Label>
                  <Input id="i-name" name="productName" defaultValue={kit.inputs.productName ?? ""} />
                </div>
                <div>
                  <Label htmlFor="i-type">Tipo de produto</Label>
                  <Input id="i-type" name="productType" defaultValue={kit.inputs.productType ?? ""} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="i-price">Preço (R$)</Label>
                    <Input id="i-price" name="price" inputMode="decimal" defaultValue={kit.inputs.price?.toString().replace(".", ",") ?? ""} />
                  </div>
                  <div>
                    <Label htmlFor="i-cpa">CPA máximo (R$)</Label>
                    <Input id="i-cpa" name="maxCpa" inputMode="decimal" placeholder="vazio = pelo preço" defaultValue={kit.inputs.maxCpa?.toString().replace(".", ",") ?? ""} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="i-budget">Orçamento diário (R$)</Label>
                  <Input id="i-budget" name="dailyBudget" inputMode="decimal" defaultValue={kit.inputs.dailyBudget?.toString().replace(".", ",") ?? ""} />
                </div>
                <div>
                  <Label htmlFor="i-checkout">Link do checkout (Cakto)</Label>
                  <Input id="i-checkout" name="checkoutUrl" defaultValue={kit.inputs.checkoutUrl ?? ""} placeholder="https://pay.cakto.com.br/…" />
                </div>
                <div>
                  <Label htmlFor="i-aud">Sobre o público</Label>
                  <Textarea id="i-aud" name="audienceNotes" rows={2} defaultValue={kit.inputs.audienceNotes ?? ""} />
                </div>
              </ActionForm>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Rocket className="h-4 w-4 text-primary" /> Lançar no Tracking
                </span>
              }
              description="Cria o produto (preço e CPA máximo) no Tracking. O sistema é consultivo: não cria nem altera campanhas no Meta."
              action={kit.productId ? <Badge tone="good">produto criado</Badge> : null}
            />
            <CardBody className="space-y-4">
              <ActionButton action={launchToTrackingAction.bind(null, kit.id)} label={kit.productId ? "Atualizar produto no Tracking" : "Lançar no Tracking"} variant="primary" />
              {mode === "demo" ? <p className="text-xs text-faint">Modo demo: nada é salvo.</p> : null}
              <div>
                <p className="mb-2 text-xs font-medium text-muted">Passo a passo no Gerenciador de Anúncios</p>
                <ol className="list-decimal space-y-2 pl-4 text-xs">
                  {steps.map((s, i) => (
                    <li key={i}>
                      <Markdown text={s} className="text-xs [&_p]:mb-0" />
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium text-muted">Parâmetros de URL</p>
                <code className="block break-all rounded bg-panel-2 p-2 text-[11px]">{structure.utms}</code>
                <div className="mt-2">
                  <CopyButton text={structure.utms} label="Copiar UTMs" />
                </div>
              </div>
              {trackingSnippet ? (
                <div>
                  <p className="mb-1 text-xs font-medium text-muted">Script de tracking do site</p>
                  <code className="block break-all rounded bg-panel-2 p-2 text-[11px]">{trackingSnippet}</code>
                </div>
              ) : (
                <p className="text-xs text-warn">
                  Nenhum site cadastrado. <Link href="/conexoes" className="underline">Cadastre em Conexões</Link> para ter o script de tracking.
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
