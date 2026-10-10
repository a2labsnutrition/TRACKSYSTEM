import { ArrowLeft, Download, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { hasAi } from "@/lib/ai/structured";
import { PDF_BUCKET, signedUrls } from "@/lib/creative/storage";
import { isServiceRoleConfigured } from "@/lib/env";
import { fmtDateTime } from "@/lib/format";
import { sp, type SearchParams } from "@/lib/page";
import { getPdfStore } from "@/lib/pdf";
import { estimatePages, storageImagePaths } from "@/lib/pdf/blocks";
import { manualChapterPrompt, manualOutlinePrompt } from "@/lib/pdf/prompts";
import { pickVersion } from "@/lib/pdf/store";
import { findTemplate } from "@/lib/pdf/templates";
import { ActionButton, ActionForm } from "@/components/action-form";
import { ChapterEditor, WriteAllChapters } from "@/components/pdf/chapter-editor";
import { DictationTextarea } from "@/components/pdf/voice";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Input, Label, Select, Textarea } from "@/components/ui/input";
import { deletePdfAction, outlineAiAction, outlineTextAction, restoreVersionAction, updateProjectAction, updateThemeAction } from "../actions";

export const metadata = { title: "Estúdio de PDF" };
export const maxDuration = 300;

export default async function PdfProjectPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SearchParams }) {
  const { id } = await params;
  const q = await searchParams;
  const { store, repo, mode } = await getPdfStore();
  const data = await store.getProject(id);
  if (!data) notFound();
  const { project, versions } = data;
  const ai = hasAi();
  const viewing = Number(sp(q, "v")) || null;
  const cur = pickVersion(versions, viewing);
  const latest = pickVersion(versions);
  const isOld = Boolean(cur && latest && cur.version !== latest.version);
  const chapters = cur?.content.chapters ?? [];
  const t = project.theme;
  const products = await repo.products();
  const live = mode === "live";
  const imgPaths = storageImagePaths(chapters.map((c) => c.markdown));
  const images = live && imgPaths.length && isServiceRoleConfigured() ? await signedUrls(PDF_BUCKET, imgPaths).catch(() => new Map<string, string>()) : new Map<string, string>();
  const pages = estimatePages(chapters.map((c) => c.markdown));
  const outlineText = chapters.map((c, i) => `${i + 1}. ${c.title}${c.summary ? ` — ${c.summary}` : ""}`).join("\n");
  const exportHref = `/api/pdf/${id}${cur ? `?v=${cur.version}` : ""}`;

  return (
    <>
      <Link href="/pdf" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-text">
        <ArrowLeft className="h-3.5 w-3.5" /> Estúdio de PDF
      </Link>
      <PageHeader
        title={project.title}
        description={`${findTemplate(t.template).name} · ${chapters.length} capítulo(s) · ~${pages} página(s) de texto${cur ? ` · versão ${cur.version}` : ""}`}
        actions={
          <>
            <a href={exportHref} className={buttonVariants({ size: "sm" })}>
              <Download className="h-3.5 w-3.5" /> Baixar PDF
            </a>
            <a href={`${exportHref}${cur ? "&" : "?"}inline=1`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "sm", variant: "secondary" })}>
              Abrir PDF <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </>
        }
      />
      {isOld ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-xs text-warn">
          Você está vendo a versão {cur!.version} (a atual é a {latest!.version}).
          <ActionButton action={restoreVersionAction.bind(null, id, cur!.version)} label="Restaurar esta versão" />
          <Link href={`/pdf/${id}`} className="underline">
            Voltar para a atual
          </Link>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="min-w-0 space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="Sumário" description="Um capítulo por linha (“Título — resumo”). Capítulos com o mesmo título mantêm o texto já escrito." />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {ai ? <ActionButton action={outlineAiAction.bind(null, id)} label="Propor sumário com IA" variant="primary" /> : null}
                <CopyButton text={manualOutlinePrompt(project)} label="Copiar prompt do sumário (IA grátis)" />
              </div>
              <ActionForm action={outlineTextAction} submitLabel="Salvar sumário" variant="secondary">
                <input type="hidden" name="id" value={id} />
                <Textarea name="text" rows={Math.min(14, Math.max(4, chapters.length + 1))} defaultValue={outlineText} key={cur?.version ?? 0} className="font-mono text-xs" />
              </ActionForm>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Capítulos"
              description="Escreva com a IA, cole a resposta da IA grátis ou escreva você mesmo. Cada salvamento vira uma versão."
              action={ai && !isOld ? <WriteAllChapters projectId={id} empty={chapters.filter((c) => !c.markdown.trim()).map((c) => ({ id: c.id, title: c.title }))} /> : null}
            />
            {chapters.length ? (
              <ul className="divide-y divide-border">
                {chapters.map((c, i) => (
                  <li key={`${c.id}-${cur?.version}`} className="px-4 py-4">
                    <ChapterEditor
                      projectId={id}
                      chapter={c}
                      index={i}
                      total={chapters.length}
                      theme={t}
                      hasAi={ai}
                      live={live}
                      aiPrompt={manualChapterPrompt(project, chapters, i, null)}
                      images={images}
                    />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 py-3 text-sm text-muted">Sem capítulos. Monte o sumário acima.</p>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader title="Briefing" />
            <CardBody>
              <ActionForm action={updateProjectAction} submitLabel="Salvar briefing" variant="secondary">
                <input type="hidden" name="id" value={id} />
                <div>
                  <Label htmlFor="b-title">Título</Label>
                  <Input id="b-title" name="title" defaultValue={project.title} />
                </div>
                <DictationTextarea name="brief" rows={7} defaultValue={project.brief} placeholder={findTemplate(t.template).briefHint} />
                <div>
                  <Label htmlFor="b-product">Produto</Label>
                  <Select id="b-product" name="productId" defaultValue={project.productId ?? ""} className="w-full">
                    <option value="">—</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
              </ActionForm>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Visual" description="Capa, cores, fonte, cabeçalho, rodapé e numeração." />
            <CardBody>
              <ActionForm action={updateThemeAction} submitLabel="Salvar visual" variant="secondary">
                <input type="hidden" name="id" value={id} />
                <div>
                  <Label htmlFor="t-sub">Subtítulo da capa</Label>
                  <Input id="t-sub" name="coverSubtitle" defaultValue={t.coverSubtitle} />
                </div>
                <div>
                  <Label htmlFor="t-author">Autor(a)</Label>
                  <Input id="t-author" name="author" defaultValue={t.author} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="t-primary">Cor principal</Label>
                    <input id="t-primary" type="color" name="primary" defaultValue={t.primary} className="h-9 w-full cursor-pointer rounded-lg border border-border-strong bg-bg" />
                  </div>
                  <div>
                    <Label htmlFor="t-accent">Cor de destaque</Label>
                    <input id="t-accent" type="color" name="accent" defaultValue={t.accent} className="h-9 w-full cursor-pointer rounded-lg border border-border-strong bg-bg" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <Label htmlFor="t-font">Fonte</Label>
                    <Select id="t-font" name="font" defaultValue={t.font} className="w-full">
                      <option value="inter">Inter (moderna)</option>
                      <option value="merriweather">Merriweather (livro)</option>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="t-size">Papel</Label>
                    <Select id="t-size" name="pageSize" defaultValue={t.pageSize} className="w-full">
                      <option value="A4">A4</option>
                      <option value="LETTER">Carta</option>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label htmlFor="t-header">Cabeçalho</Label>
                  <Input id="t-header" name="header" defaultValue={t.header} placeholder="ex.: nome do curso" />
                </div>
                <div>
                  <Label htmlFor="t-footer">Rodapé</Label>
                  <Input id="t-footer" name="footer" defaultValue={t.footer} placeholder="ex.: © 2026 Seu Nome — proibida a revenda" />
                </div>
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input type="checkbox" name="showToc" value="1" defaultChecked={t.showToc} /> Sumário automático
                </label>
                <label className="flex items-center gap-2 text-xs text-muted">
                  <input type="checkbox" name="pageNumbers" value="1" defaultChecked={t.pageNumbers} /> Numeração de páginas
                </label>
              </ActionForm>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={`Versões (${versions.length})`} />
            <ul className="max-h-80 divide-y divide-border overflow-y-auto">
              {versions.map((v) => (
                <li key={v.version} className="flex items-start justify-between gap-2 px-4 py-2 text-xs">
                  <span className="min-w-0">
                    <Link href={`/pdf/${id}?v=${v.version}`} className={v.version === cur?.version ? "font-medium text-primary" : "hover:underline"}>
                      Versão {v.version}
                    </Link>
                    <span className="block text-faint">
                      {v.note ?? ""} · {fmtDateTime(v.createdAt)}
                    </span>
                  </span>
                  {v.version === latest?.version ? <Badge tone="good">atual</Badge> : null}
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardBody className="space-y-2 text-xs text-muted">
              <p>
                O PDF é gerado no servidor, com fontes embutidas, capa, sumário com links e numeração. Para entregar ao aluno, baixe e envie na área de membros da Cakto (ou
                onde você entrega o produto).
              </p>
              <p>Alertas de política aparecem em cada capítulo (saúde, renda, antes/depois…). Revise antes de publicar.</p>
              <ActionButton action={deletePdfAction.bind(null, id)} label="Excluir material" />
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
