import { Layers } from "lucide-react";
import Link from "next/link";
import { getDiscoverStore } from "@/lib/discover";
import { findNiche, findSubniche } from "@/lib/discover/niches";
import { fmtBRL, fmtRelative } from "@/lib/format";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Kits de campanha" };

export default async function Kits() {
  const { store } = await getDiscoverStore();
  const kits = await store.listKits();
  return (
    <>
      <PageHeader
        title="Kits de campanha"
        description="Cada kit reúne plano de ataque, oferta, página, VSL, roteiros, estrutura da campanha e conformidade — com histórico de versões."
        actions={
          <LinkButton href="/descobrir" size="sm">
            Novo kit (escolher nicho)
          </LinkButton>
        }
      />
      <Card>
        {kits.length ? (
          <ul className="divide-y divide-border">
            {kits.map((k) => {
              const n = findNiche(k.nicheSlug);
              const sub = n ? findSubniche(n, k.subnicheSlug) : undefined;
              return (
                <li key={k.id}>
                  <Link href={`/kits/${k.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-panel-2">
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{k.title}</span>
                      <span className="block text-xs text-muted">
                        {n?.name ?? k.nicheSlug}
                        {sub ? ` › ${sub.name}` : ""} · atualizado {fmtRelative(k.updatedAt)}
                      </span>
                    </span>
                    <span className="flex gap-1.5">
                      {k.inputs.price ? <Badge>{fmtBRL(k.inputs.price)}</Badge> : null}
                      {k.productId ? <Badge tone="good">no Tracking</Badge> : null}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState icon={<Layers className="h-6 w-6" />} title="Nenhum kit ainda" description="Escolha um nicho em Descobrir e clique em “Criar plano de ataque”." />
        )}
      </Card>
    </>
  );
}
