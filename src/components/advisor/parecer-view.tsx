import { AlertTriangle, CheckCircle2, CircleHelp, CircleSlash, Compass, FlaskConical, Lightbulb, ListChecks, RotateCcw, Target } from "lucide-react";
import { BOTTLENECK_LABEL, normalizeParecer } from "@/lib/advisor/schema";
import type { AdvisorReport } from "@/lib/data/types";
import { STATUS_LABEL } from "@/lib/decision/rules";
import { fmtDateTime } from "@/lib/format";
import { DecisionBadge } from "@/components/decision-badge";
import { Badge } from "@/components/ui/badge";

/** Exibe um Parecer salvo, na estrutura fixa do escopo. */
export function ParecerView({ report, tz }: { report: AdvisorReport; tz: string }) {
  const c = normalizeParecer(report.content);
  const ai = !report.model.startsWith("regras");
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <DecisionBadge status={c.veredito.status} large />
        <span className="text-xs text-muted" title="Quanto os dados sustentam o veredito — não é a chance de dar certo">
          Confiança {c.veredito.confianca}
        </span>
        {report.rulesStatus && report.rulesStatus !== c.veredito.status ? (
          <Badge tone="warn">Regras diziam: {STATUS_LABEL[report.rulesStatus]}</Badge>
        ) : null}
        <span className="ml-auto text-[11px] text-faint">
          {ai ? `IA (${report.model})` : "Parecer automático (sem IA)"} · {fmtDateTime(report.createdAt, tz)}
        </span>
      </div>
      <p className="text-sm">{c.veredito.justificativa}</p>

      {c.alerta_tracking ? (
        <p className="flex gap-2 rounded-lg border border-bad/30 bg-bad/5 px-3 py-2 text-sm text-bad">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {c.alerta_tracking}
        </p>
      ) : null}

      {c.o_que_nao_sabemos.length || c.o_que_mudaria_a_decisao.length ? (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {c.o_que_nao_sabemos.length ? (
            <Section icon={<CircleHelp className="h-4 w-4" />} title="O que ainda não sabemos">
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                {c.o_que_nao_sabemos.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </Section>
          ) : null}
          {c.o_que_mudaria_a_decisao.length ? (
            <Section icon={<RotateCcw className="h-4 w-4" />} title="O que mudaria esta decisão">
              <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                {c.o_que_mudaria_a_decisao.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </Section>
          ) : null}
        </div>
      ) : null}

      <Section icon={<Target className="h-4 w-4" />} title="Diagnóstico">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {c.diagnostico.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
        <p className="mt-2 text-sm">
          <b>Gargalo:</b> {BOTTLENECK_LABEL[c.gargalo.area]} — <span className="text-muted">{c.gargalo.explicacao}</span>
        </p>
      </Section>

      <Section icon={<ListChecks className="h-4 w-4" />} title="Plano para os próximos dias">
        <ol className="space-y-2">
          {c.plano.map((p, i) => (
            <li key={i} className="flex gap-3 text-sm">
              <span className="w-24 shrink-0 text-xs font-semibold text-primary">{p.quando}</span>
              <span>
                {p.acao}
                {p.condicao ? <span className="block text-xs text-muted">Condição: {p.condicao}</span> : null}
              </span>
            </li>
          ))}
        </ol>
      </Section>

      {c.testes.length ? (
        <Section icon={<FlaskConical className="h-4 w-4" />} title="Testes sugeridos">
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {c.testes.map((t, i) => (
              <div key={i} className="rounded-lg border border-border bg-bg/40 p-3 text-xs">
                <p className="text-sm font-medium">{t.hipotese}</p>
                <p className="mt-1 text-muted">Mudar: {t.o_que_mudar}</p>
                <p className="text-muted">Sucesso: {t.metrica_sucesso}</p>
                <p className="text-muted">
                  Orçamento: {t.orcamento} · Prazo: {t.prazo}
                </p>
              </div>
            ))}
          </div>
        </Section>
      ) : null}

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <Section icon={<AlertTriangle className="h-4 w-4" />} title="Riscos">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {c.riscos.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Section>
        <Section icon={<CircleSlash className="h-4 w-4" />} title="O que NÃO mexer">
          <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
            {c.nao_mexer.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Section>
      </div>

      <Section icon={<Compass className="h-4 w-4" />} title="Caminhos possíveis">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {c.caminhos.map((p, i) => (
            <div key={i} className="rounded-lg border border-border bg-bg/40 p-3 text-xs">
              <p className="text-sm font-medium">{p.nome}</p>
              <p className="mt-1 text-muted">{p.descricao}</p>
              <p className="mt-2 text-good">+ {p.pros.join(" · ")}</p>
              <p className="text-bad">− {p.contras.join(" · ")}</p>
            </div>
          ))}
        </div>
      </Section>

      {c.proximos_criativos.length ? (
        <Section icon={<Lightbulb className="h-4 w-4" />} title="Próximos criativos para produzir">
          <ul className="space-y-1.5 text-sm">
            {c.proximos_criativos.map((p, i) => (
              <li key={i} className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-violet" />
                <span>
                  <b>{p.angulo}:</b> “{p.gancho}” <span className="text-xs text-muted">— {p.motivo}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
        {icon}
        {title}
      </p>
      {children}
    </div>
  );
}
