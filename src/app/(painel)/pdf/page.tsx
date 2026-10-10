import { FileText } from "lucide-react";
import Link from "next/link";
import { getPdfStore } from "@/lib/pdf";
import { findTemplate, PDF_TEMPLATES } from "@/lib/pdf/templates";
import { fmtDate } from "@/lib/format";
import { ActionForm } from "@/components/action-form";
import { DictationTextarea } from "@/components/pdf/voice";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Label, Select } from "@/components/ui/input";
import { createPdfAction } from "./actions";

export const metadata = { title: "Estúdio de PDF" };

export default async function PdfStudio() {
  const { store, repo } = await getPdfStore();
  const [projects, products] = await Promise.all([store.listProjects(), repo.products()]);
  const productName = new Map(products.map((p) => [p.id, p.name]));
  return (
    <>
      <PageHeader title="Estúdio de PDF" description="Crie o e-book, guia, workbook ou checklist do seu produto: briefing (escrito ou ditado) → sumário → capítulos → visual → PDF pronto." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader title={`Seus materiais (${projects.length})`} />
          {projects.length ? (
            <ul className="divide-y divide-border">
              {projects.map((p) => (
                <li key={p.id}>
                  <Link href={`/pdf/${p.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-panel-2">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{p.title}</span>
                      <span className="block text-xs text-muted">
                        {findTemplate(p.theme.template).name} · criado em {fmtDate(p.createdAt)}
                      </span>
                    </span>
                    {p.productId && productName.get(p.productId) ? <Badge tone="primary">{productName.get(p.productId)}</Badge> : null}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<FileText className="h-6 w-6" />} title="Nenhum material ainda" description="Comece pelo formulário ao lado." />
          )}
        </Card>
        <Card className="min-w-0">
          <CardHeader title="Novo material" />
          <CardBody>
            <ActionForm action={createPdfAction} submitLabel="Criar e abrir">
              <div>
                <Label htmlFor="title">Título</Label>
                <Input id="title" name="title" placeholder="ex.: Guia de Doces para Vender" />
              </div>
              <div>
                <Label htmlFor="template">Modelo</Label>
                <Select id="template" name="template" defaultValue="guia" className="w-full">
                  {PDF_TEMPLATES.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {t.description}
                    </option>
                  ))}
                </Select>
              </div>
              {products.length ? (
                <div>
                  <Label htmlFor="productId">Produto (opcional)</Label>
                  <Select id="productId" name="productId" defaultValue="" className="w-full">
                    <option value="">—</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : null}
              <div>
                <Label>Briefing — escreva ou dite como o material deve ser</Label>
                <DictationTextarea name="brief" rows={8} placeholder={PDF_TEMPLATES[0].briefHint} />
                <p className="mt-1 text-[11px] text-faint">Tema, público, tom, número de páginas, estrutura, estilo visual. Instruções soltas funcionam.</p>
              </div>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
