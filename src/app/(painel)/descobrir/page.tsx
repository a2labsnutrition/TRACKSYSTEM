import { BookMarked, Compass, Layers } from "lucide-react";
import Link from "next/link";
import { hasAi } from "@/lib/ai/structured";
import { getDiscoverStore } from "@/lib/discover";
import { NICHES, POLICY_LABEL, type PolicyLevel } from "@/lib/discover/niches";
import { computeNicheScore } from "@/lib/discover/score";
import { providerStatuses } from "@/lib/integrations/adlibrary";
import { sp, type SearchParams } from "@/lib/page";
import { todayIn } from "@/lib/tz";
import { cn } from "@/lib/utils";
import { scoreTone } from "@/components/discover/score";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";

export const metadata = { title: "Descobrir & Criar" };

const POLICY_TONE: Record<PolicyLevel, "good" | "warn" | "bad"> = { baixo: "good", medio: "warn", alto: "bad" };

export default async function Descobrir({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const q = (sp(params, "q") ?? "").trim().toLowerCase();
  const risco = sp(params, "risco") ?? "";
  const ordem = sp(params, "ordem") ?? "score";

  const { store, workspace, mode } = await getDiscoverStore();
  const [refs, seeds, kits] = await Promise.all([store.listReferences(), store.listNicheSeeds(), store.listKits()]);
  const today = todayIn(workspace.timezone);

  const rows = NICHES.map((n) => ({ n, score: computeNicheScore(n, refs, seeds.get(n.slug) ?? null, today) }))
    .filter(({ n }) => !q || n.name.toLowerCase().includes(q) || n.subniches.some((s) => s.name.toLowerCase().includes(q)))
    .filter(({ n }) => !risco || n.policy.level === risco)
    .sort((a, b) => {
      if (ordem === "ticket") return b.n.ticket.max - a.n.ticket.max;
      if (ordem === "facilidade") return b.n.ease - a.n.ease;
      if (ordem === "referencias") return b.score.references - a.score.references;
      return (b.score.total ?? -1) - (a.score.total ?? -1);
    });

  const providers = providerStatuses({ hasAi: hasAi(), thirdPartyConfigured: false });

  return (
    <>
      <PageHeader
        title="Descobrir & Criar"
        description="Escolha o nicho, estude referências reais e gere o kit completo da campanha (oferta, página, VSL, roteiros, estrutura e políticas)."
        actions={
          <>
            <LinkButton href="/descobrir/referencias" variant="secondary" size="sm">
              <BookMarked className="h-3.5 w-3.5" /> Referências ({refs.length})
            </LinkButton>
            <LinkButton href="/kits" variant="secondary" size="sm">
              <Layers className="h-3.5 w-3.5" /> Kits ({kits.length})
            </LinkButton>
          </>
        }
      />

      {mode === "demo" ? (
        <p className="mb-4 rounded-lg border border-info/30 bg-info/10 px-3 py-2 text-xs text-info">Modo demo: as referências de exemplo são fictícias e nada é salvo no banco.</p>
      ) : null}

      <Card className="mb-5">
        <CardHeader
          title="Fontes de referências"
          description="Todo dado mostra a origem. A API oficial da Biblioteca de Anúncios do Meta não entrega anúncios comerciais do Brasil de forma ampla — sem scraping que viole os termos."
        />
        <CardBody className="grid gap-3 sm:grid-cols-3">
          {providers.map((p) => (
            <div key={p.id} className="rounded-lg border border-border p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-sm font-medium">{p.label}</span>
                <Badge tone={p.available ? "good" : "neutral"}>{p.available ? "ativo" : "inativo"}</Badge>
              </div>
              <p className="text-xs text-muted">{p.detail}</p>
            </div>
          ))}
        </CardBody>
      </Card>

      <form className="mb-4 flex flex-wrap items-center gap-2" action="/descobrir">
        <Input name="q" defaultValue={sp(params, "q") ?? ""} placeholder="Buscar nicho ou subnicho…" className="w-full sm:w-64" />
        <Select name="risco" defaultValue={risco}>
          <option value="">Qualquer risco de política</option>
          <option value="baixo">Risco baixo</option>
          <option value="medio">Risco médio</option>
          <option value="alto">Risco alto</option>
        </Select>
        <Select name="ordem" defaultValue={ordem}>
          <option value="score">Ordenar por score</option>
          <option value="ticket">Ticket</option>
          <option value="facilidade">Facilidade</option>
          <option value="referencias">Nº de referências</option>
        </Select>
        <button type="submit" className="h-9 rounded-lg border border-border-strong bg-panel-2 px-3 text-sm hover:bg-border">
          Filtrar
        </button>
        {q || risco || ordem !== "score" ? (
          <Link href="/descobrir" className="text-xs text-muted hover:text-text">
            limpar
          </Link>
        ) : null}
      </form>

      <p className="mb-3 text-xs text-faint">
        Score 0–100 para priorizar o estudo, não previsão de vendas. Componentes: sinais de escala (35%), saturação (20%, inverso), ticket (15%), facilidade (15%) e risco de
        política (15%, inverso). &quot;Parcial&quot; = falta dado de algum componente.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map(({ n, score }) => (
          <Link key={n.slug} href={`/descobrir/${n.slug}`} className="group min-w-0">
            <Card className="h-full p-4 transition-colors group-hover:border-border-strong">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium">{n.name}</p>
                  <p className="mt-0.5 truncate text-xs text-muted">{n.subniches.map((s) => s.name).join(" · ")}</p>
                </div>
                <div className="text-right">
                  <p className={cn("tabular text-2xl font-semibold leading-none", scoreTone(score.total))}>{score.total ?? "—"}</p>
                  {score.partial ? <p className="mt-1 text-[10px] text-faint">parcial</p> : null}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone={POLICY_TONE[n.policy.level]}>{POLICY_LABEL[n.policy.level]}</Badge>
                <Badge>
                  R$ {n.ticket.min}–{n.ticket.max}
                </Badge>
                <Badge tone={score.references ? "primary" : "neutral"}>{score.references} ref.</Badge>
                {seeds.has(n.slug) ? <Badge tone="violet">estimativa IA</Badge> : null}
              </div>
            </Card>
          </Link>
        ))}
      </div>
      {!rows.length ? (
        <div className="py-10 text-center text-sm text-muted">
          <Compass className="mx-auto mb-2 h-6 w-6 text-faint" />
          Nenhum nicho com esses filtros.
        </div>
      ) : null}
    </>
  );
}
