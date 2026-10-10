import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { hasAi } from "@/lib/ai/structured";
import { getDiscoverStore } from "@/lib/discover";
import { NICHES } from "@/lib/discover/niches";
import { sp, type SearchParams } from "@/lib/page";
import { todayIn } from "@/lib/tz";
import { ActionButton, ActionForm } from "@/components/action-form";
import { ReferenceCard, ReferenceForm } from "@/components/discover/references";
import { PageHeader } from "@/components/layout/page-header";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input, Select } from "@/components/ui/input";
import { createCollectionAction, removeFromCollectionAction } from "../actions";

export const metadata = { title: "Referências" };
export const maxDuration = 120;

export default async function Referencias({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const nicho = sp(params, "nicho") ?? "";
  const colecao = sp(params, "colecao") ?? "";
  const ai = hasAi();
  const { store, workspace } = await getDiscoverStore();
  const [all, collections] = await Promise.all([store.listReferences(), store.listCollections()]);
  const today = todayIn(workspace.timezone);
  const col = collections.find((c) => c.id === colecao);
  const refs = all.filter((r) => (!nicho || r.nicheSlug === nicho) && (!col || col.items.some((i) => i.refId === r.id)));
  const byId = new Map(all.map((r) => [r.id, r]));

  return (
    <>
      <Link href="/descobrir" className="mb-3 inline-flex items-center gap-1 text-xs text-muted hover:text-text">
        <ArrowLeft className="h-3.5 w-3.5" /> Nichos
      </Link>
      <PageHeader title="Referências e swipe" description="Anúncios de referência com origem e data, análise da IA e coleções para organizar o estudo." />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <form action="/descobrir/referencias" className="flex flex-wrap items-center gap-2">
            <Select name="nicho" defaultValue={nicho}>
              <option value="">Todos os nichos</option>
              {NICHES.map((n) => (
                <option key={n.slug} value={n.slug}>
                  {n.name}
                </option>
              ))}
            </Select>
            <Select name="colecao" defaultValue={colecao}>
              <option value="">Todas as coleções</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <button type="submit" className="h-9 rounded-lg border border-border-strong bg-panel-2 px-3 text-sm hover:bg-border">
              Filtrar
            </button>
          </form>
          <Card>
            <CardHeader title={`${refs.length} referência(s)`} />
            {refs.length ? (
              <div className="divide-y divide-border">
                {refs.map((r) => (
                  <ReferenceCard key={r.id} r={r} collections={collections} hasAi={ai} today={today} showNiche />
                ))}
              </div>
            ) : (
              <EmptyState title="Nenhuma referência" description="Importe anúncios pelo formulário ao lado." />
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Importar referência" description="Link + dados que você vê na Biblioteca de Anúncios." />
            <CardBody>
              <ReferenceForm hasAi={ai} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Coleções (swipe)" />
            <CardBody className="space-y-4">
              <ActionForm action={createCollectionAction} submitLabel="Criar coleção" variant="secondary">
                <Input name="name" placeholder="ex.: Ganchos de curiosidade" />
              </ActionForm>
              {collections.map((c) => (
                <div key={c.id} className="rounded-lg border border-border p-3">
                  <Link href={`/descobrir/referencias?colecao=${c.id}`} className="text-sm font-medium hover:underline">
                    {c.name} ({c.items.length})
                  </Link>
                  <ul className="mt-2 space-y-2">
                    {c.items.map((i) => {
                      const r = byId.get(i.refId);
                      return (
                        <li key={i.refId} className="flex items-start justify-between gap-2 text-xs">
                          <span className="min-w-0 text-muted">
                            {r ? `${r.advertiser ?? "Sem anunciante"} — ${r.analysis?.gancho ?? r.hook ?? r.copy?.slice(0, 60) ?? ""}` : "Referência removida"}
                            {i.note ? <span className="block text-faint">{i.note}</span> : null}
                          </span>
                          <ActionButton action={removeFromCollectionAction.bind(null, c.id, i.refId)} label="Tirar" />
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
