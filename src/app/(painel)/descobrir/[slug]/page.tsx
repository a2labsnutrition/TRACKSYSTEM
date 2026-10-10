import { ArrowLeft, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasAi } from "@/lib/ai/structured";
import { getDiscoverStore } from "@/lib/discover";
import { findNiche, POLICY_LABEL } from "@/lib/discover/niches";
import { computeNicheScore } from "@/lib/discover/score";
import { adLibrarySearchUrl } from "@/lib/integrations/adlibrary";
import { fmtDate } from "@/lib/format";
import { todayIn } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { ActionButton, ActionForm } from "@/components/action-form";
import { ReferenceCard, ReferenceForm } from "@/components/discover/references";
import { ScoreBreakdown, scoreTone } from "@/components/discover/score";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { createKitAction, estimateNicheAction } from "../actions";

export const maxDuration = 300;

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const n = findNiche((await params).slug);
  return { title: n ? `${n.name} · Descobrir` : "Descobrir" };
}

export default async function NichePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const niche = findNiche(slug);
  if (!niche) notFound();
  const ai = hasAi();
  const { store, workspace } = await getDiscoverStore();
  const [allRefs, seed, collections] = await Promise.all([store.listReferences(), store.getNicheSeed(slug), store.listCollections()]);
  const today = todayIn(workspace.timezone);
  const score = computeNicheScore(niche, allRefs, seed, today);
  const refs = allRefs.filter((r) => r.nicheSlug === slug);
  const policyTone = niche.policy.level === "alto" ? "bad" : niche.policy.level === "medio" ? "warn" : "good";

  return (
    <>
      <Link href="/descobrir" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-text">
        <ArrowLeft className="h-3.5 w-3.5" /> Nichos
      </Link>
      <PageHeader
        title={niche.name}
        description={niche.subniches.map((s) => s.name).join(" · ")}
        actions={
          <a href={adLibrarySearchUrl(niche.name)} target="_blank" rel="noopener noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-panel-2 px-3 text-xs font-medium hover:bg-border">
            Pesquisar na Biblioteca de Anúncios <ExternalLink className="h-3 w-3" />
          </a>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          <Card>
            <CardHeader
              title={
                <span className="flex items-center gap-3">
                  Score de potencial
                  <span className={cn("tabular text-2xl font-semibold", scoreTone(score.total))}>{score.total ?? "—"}</span>
                  {score.partial ? <Badge tone="warn">parcial</Badge> : null}
                </span>
              }
              description="Indicador para priorizar o estudo — não é previsão de vendas. Cada componente mostra de onde veio o número."
            />
            <CardBody>
              <ScoreBreakdown score={score} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`Referências do nicho (${refs.length})`} description="Anúncios que você trouxe da Biblioteca de Anúncios ou de outras fontes, com origem e data." />
            {refs.length ? (
              <div className="divide-y divide-border">
                {refs.map((r) => (
                  <ReferenceCard key={r.id} r={r} collections={collections} hasAi={ai} today={today} />
                ))}
              </div>
            ) : (
              <EmptyState
                title="Nenhuma referência ainda"
                description="Abra a Biblioteca de Anúncios (botão acima), encontre anúncios no ar há bastante tempo e com várias variações, e importe aqui. Com 3+ referências o score passa a usar dados medidos."
              />
            )}
          </Card>

          <Card>
            <CardHeader title="Importar referência" description="Cole o link e os dados que você vê. Sem coleta automática que viole os termos do Meta." />
            <CardBody>
              <ReferenceForm niche={niche} hasAi={ai} />
            </CardBody>
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Plano de ataque" description="Cria o kit e gera tudo: plano (5+ ângulos), oferta, página + prompt do Lovable, VSL, roteiros, estrutura da campanha e políticas." />
            <CardBody>
              <ActionForm action={createKitAction} submitLabel="Criar plano de ataque">
                <input type="hidden" name="nicheSlug" value={niche.slug} />
                <div>
                  <Label htmlFor="k-sub">Subnicho</Label>
                  <Select id="k-sub" name="subnicheSlug" defaultValue="" className="w-full">
                    <option value="">Nicho inteiro</option>
                    {niche.subniches.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="k-name">Nome do produto (se já tiver)</Label>
                  <Input id="k-name" name="productName" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="k-price">Preço (R$)</Label>
                    <Input id="k-price" name="price" inputMode="decimal" placeholder="ex.: 97" />
                  </div>
                  <div>
                    <Label htmlFor="k-budget">Orçamento/dia (R$)</Label>
                    <Input id="k-budget" name="dailyBudget" inputMode="decimal" placeholder="ex.: 100" />
                  </div>
                </div>
                <div>
                  <Label htmlFor="k-type">Tipo de produto</Label>
                  <Input id="k-type" name="productType" placeholder="curso, e-book, mentoria… (vazio = IA sugere)" />
                </div>
                <div>
                  <Label htmlFor="k-checkout">Link do checkout (Cakto)</Label>
                  <Input id="k-checkout" name="checkoutUrl" placeholder="https://pay.cakto.com.br/…" />
                </div>
                <div>
                  <Label htmlFor="k-aud">Sobre o público (opcional)</Label>
                  <Textarea id="k-aud" name="audienceNotes" rows={2} />
                </div>
                {refs.length ? (
                  <div>
                    <Label>Referências usadas como inspiração</Label>
                    <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                      {refs.map((r) => (
                        <label key={r.id} className="flex items-start gap-2 text-xs">
                          <input type="checkbox" name="refIds" value={r.id} defaultChecked className="mt-0.5" />
                          <span className="min-w-0 truncate">
                            {r.advertiser ?? "Sem anunciante"} — {r.analysis?.gancho ?? r.hook ?? r.copy?.slice(0, 60) ?? "sem texto"}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
                {!ai ? <p className="text-xs text-warn">Sem ANTHROPIC_API_KEY o kit é criado, mas só a estrutura da campanha é gerada automaticamente.</p> : null}
              </ActionForm>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Risco de política" action={<Badge tone={policyTone}>{POLICY_LABEL[niche.policy.level]}</Badge>} />
            <CardBody className="space-y-2 text-xs text-muted">
              {niche.policy.reasons.length ? niche.policy.reasons.map((r) => <p key={r}>{r}</p>) : <p>Sem restrições específicas conhecidas para o tema — as regras gerais do Meta continuam valendo.</p>}
              <p className="text-faint">Fonte: catálogo do sistema.</p>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Estimativa da IA"
              description="Sinais de mercado estimados — sempre rotulados como estimativa, nunca como dado medido."
              action={ai ? <ActionButton action={estimateNicheAction.bind(null, slug)} label={seed ? "Atualizar" : "Gerar estimativa"} /> : null}
            />
            <CardBody className="space-y-2 text-xs">
              {seed ? (
                <>
                  <p className="text-faint">
                    Gerada em {fmtDate(seed.generatedAt)}. Escala estimada {seed.escala_estimada}/100 · saturação estimada {seed.saturacao_estimada}/100.
                  </p>
                  <p className="text-muted">{seed.justificativa}</p>
                  {seed.subnichos_em_alta.length ? <p><b>Subnichos em alta (estimativa):</b> {seed.subnichos_em_alta.join(", ")}</p> : null}
                  {seed.angulos.length ? <p><b>Ângulos comuns:</b> {seed.angulos.join(" · ")}</p> : null}
                  {seed.estruturas_oferta.length ? <p><b>Estruturas de oferta:</b> {seed.estruturas_oferta.join(" · ")}</p> : null}
                  {seed.formatos_que_mais_aparecem.length ? <p><b>Formatos:</b> {seed.formatos_que_mais_aparecem.join(", ")}</p> : null}
                  {seed.alertas.length ? <p className="text-warn"><b>Alertas:</b> {seed.alertas.join(" · ")}</p> : null}
                </>
              ) : (
                <p className="text-muted">{ai ? "Ainda não gerada." : "Configure ANTHROPIC_API_KEY na Vercel para gerar."}</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
