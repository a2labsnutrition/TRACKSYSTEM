import { AlertTriangle, Ban, CalendarRange, Clapperboard, ListChecks, Rocket, ShieldAlert, Sparkles, Target, TrendingUp } from "lucide-react";
import { fmtDateTime } from "@/lib/format";
import { ACTION_LABEL, ROLE_LABEL, type Plano } from "@/lib/strategist/schema";
import { Badge, type Tone } from "@/components/ui/badge";

const ACTION_TONE: Record<Plano["acoes_hoje"][number]["acao"], Tone> = {
  pausar: "bad",
  reduzir_orcamento: "warn",
  aumentar_orcamento: "good",
  manter: "info",
  duplicar: "good",
  novo_criativo: "violet",
  ajustar_funil: "warn",
  corrigir_tracking: "bad",
  aguardar: "neutral",
};

const ROLE_TONE: Record<Plano["ofertas"][number]["papel"], Tone> = {
  escalar: "good",
  manter: "info",
  consertar_funil: "warn",
  cortar: "bad",
  testar: "neutral",
};

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
        <span className="text-muted">{icon}</span> {title}
      </h3>
      {children}
    </section>
  );
}

/** Plano do Claudinho na estrutura fixa. */
export function PlanView({ plan, createdAt, model, tz }: { plan: Plano; createdAt: string; model: string; tz: string }) {
  const ai = !model.startsWith("regras");
  const bater = plan.situacao.vai_bater_a_meta;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={bater === "sim" ? "good" : bater === "nao" ? "bad" : "warn"}>
          {bater === "sim" ? "Vai bater a meta" : bater === "nao" ? "Não bate a meta no ritmo atual" : "Meta incerta"}
        </Badge>
        <span className="ml-auto text-[11px] text-faint">
          {ai ? `Claudinho (${model})` : "Plano automático das regras (sem IA)"} · {fmtDateTime(createdAt, tz)}
        </span>
      </div>
      <p className="text-sm">{plan.situacao.resumo}</p>

      {plan.acoes_hoje.length ? (
        <Section icon={<Rocket className="h-4 w-4" />} title="Faça hoje">
          <ol className="space-y-2">
            {[...plan.acoes_hoje]
              .sort((a, b) => a.prioridade - b.prioridade)
              .map((a, i) => (
                <li key={i} className="rounded-lg border border-border p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-faint">#{i + 1}</span>
                    <Badge tone={ACTION_TONE[a.acao]}>{ACTION_LABEL[a.acao]}</Badge>
                    {a.campanha ? <span className="min-w-0 break-all text-sm font-medium">{a.campanha}</span> : null}
                    <span className="ml-auto text-[11px] text-muted">{a.quando}</span>
                  </div>
                  {a.valor_atual || a.valor_novo ? (
                    <p className="mt-1.5 text-sm tabular">
                      {a.valor_atual ?? "—"} {a.valor_novo ? <>→ <b>{a.valor_novo}</b></> : null}
                    </p>
                  ) : null}
                  <p className="mt-1 text-sm text-muted">{a.motivo}</p>
                  <p className="mt-1 text-[11px] text-faint">Desfazer se: {a.reverter_se}</p>
                </li>
              ))}
          </ol>
          <p className="mt-2 text-[11px] text-faint">Consultivo: nada é alterado na sua conta. Orçamento sempre na campanha (CBO), na moeda da conta.</p>
        </Section>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Section icon={<Target className="h-4 w-4" />} title="Diagnóstico">
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {plan.diagnostico.map((d, i) => (
              <li key={i}>{d}</li>
            ))}
          </ul>
        </Section>
        <Section icon={<TrendingUp className="h-4 w-4" />} title="Papel de cada oferta">
          <ul className="space-y-2">
            {plan.ofertas.map((o, i) => (
              <li key={i} className="text-sm">
                <span className="inline-flex flex-wrap items-center gap-2">
                  <Badge tone={ROLE_TONE[o.papel]}>{ROLE_LABEL[o.papel]}</Badge>
                  <b>{o.produto}</b>
                  <span className="text-xs text-muted">lucro por cliente: {o.lucro_por_cliente}</span>
                </span>
                <p className="mt-0.5 text-muted">{o.explicacao}</p>
              </li>
            ))}
          </ul>
        </Section>
      </div>

      {plan.plano_7_dias.length ? (
        <Section icon={<CalendarRange className="h-4 w-4" />} title="Plano dos próximos 7 dias">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {plan.plano_7_dias.map((d, i) => (
              <div key={i} className="rounded-lg border border-border p-3">
                <p className="text-xs font-semibold text-primary">{d.quando}</p>
                <p className="text-sm font-medium">{d.foco}</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-muted">
                  {d.acoes.map((a, j) => (
                    <li key={j}>{a}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {plan.alavancas_ticket.length ? (
          <Section icon={<Sparkles className="h-4 w-4" />} title="Aumentar o ticket (bump, upsell, preço)">
            <ul className="space-y-2 text-sm">
              {plan.alavancas_ticket.map((a, i) => (
                <li key={i}>
                  <b>{a.ideia}</b> <span className="text-good">{a.ganho_estimado_por_cliente}</span>
                  <p className="text-muted">{a.como_fazer}</p>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
        {plan.criativos.length ? (
          <Section icon={<Clapperboard className="h-4 w-4" />} title="Criativos para produzir">
            <ul className="space-y-2 text-sm">
              {plan.criativos.map((c, i) => (
                <li key={i}>
                  <span className="text-xs text-faint">
                    {c.oferta} · {c.angulo} · {c.formato}
                  </span>
                  <p>“{c.gancho}”</p>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Section icon={<ListChecks className="h-4 w-4" />} title="Regras de escala desta conta">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {plan.regras_de_escala.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Section>
        <Section icon={<Ban className="h-4 w-4" />} title="Não fazer">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {plan.nao_fazer.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Section>
        {plan.dados_faltando.length ? (
          <Section icon={<ShieldAlert className="h-4 w-4" />} title="O que limita este plano">
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
              {plan.dados_faltando.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>
      {!ai ? (
        <p className="flex gap-2 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-xs text-warn">
          <AlertTriangle className="h-4 w-4 shrink-0" /> Plano automático (só as regras). Com a chave da Anthropic, o Claudinho escreve o plano completo com criativos e plano de 7 dias.
        </p>
      ) : null}
    </div>
  );
}
