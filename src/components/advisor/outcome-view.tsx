import { ArrowDownRight, ArrowUpRight, History, Minus } from "lucide-react";
import { EVIDENCE_LABEL, OUTCOME_VERDICT_LABEL, type OutcomeVerdict, type OutcomeWindow, type ReportOutcome } from "@/lib/advisor/outcome";
import { STATUS_LABEL } from "@/lib/decision/rules";
import { fmtBRL, fmtDayShort, fmtInt, fmtRoas } from "@/lib/format";
import { Badge, type Tone } from "@/components/ui/badge";

export const OUTCOME_TONE: Record<OutcomeVerdict, Tone> = {
  acertou: "good",
  errou: "bad",
  inconclusivo: "warn",
  nao_avaliavel: "neutral",
  aguardando: "info",
};

export function OutcomeBadge({ verdict, prefix }: { verdict: OutcomeVerdict; prefix?: string }) {
  return (
    <Badge tone={OUTCOME_TONE[verdict]}>
      {prefix ? `${prefix}: ` : ""}
      {OUTCOME_VERDICT_LABEL[verdict]}
    </Badge>
  );
}

function cpaCell(w: OutcomeWindow) {
  if (w.cpa == null) return w.spend > 0 ? "sem venda" : "—";
  const ci = w.cpaLower != null ? ` (${fmtBRL(w.cpaLower)}–${w.cpaUpper != null ? fmtBRL(w.cpaUpper) : "∞"})` : "";
  return (
    <>
      {fmtBRL(w.cpa)}
      <span className="text-faint">{ci}</span>
    </>
  );
}

function range(w: OutcomeWindow) {
  return w.days > 0 ? `${fmtDayShort(w.from)}–${fmtDayShort(w.to)}` : "—";
}

/** "O que aconteceu depois" de um parecer: antes x depois, e se o veredito se confirmou. */
export function OutcomeView({ outcome: o }: { outcome: ReportOutcome }) {
  const TrendIcon = o.trend?.direction === "melhorou" ? ArrowUpRight : o.trend?.direction === "piorou" ? ArrowDownRight : Minus;
  return (
    <div className="rounded-lg border border-border bg-panel-2/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <History className="h-4 w-4 text-muted" /> O que aconteceu depois
        </span>
        <OutcomeBadge verdict={o.consultant} prefix={`Parecer (${STATUS_LABEL[o.status]})`} />
        {o.rules && o.rulesStatus ? <OutcomeBadge verdict={o.rules} prefix={`Regras (${STATUS_LABEL[o.rulesStatus]})`} /> : null}
        {o.evidence ? <span className="text-[11px] text-faint">Resultado: {EVIDENCE_LABEL[o.evidence]}</span> : null}
      </div>

      {o.ready || o.after.days > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-xs tabular">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="py-1 pr-3 font-semibold" />
                <th className="py-1 pr-3 font-semibold">Dias</th>
                <th className="py-1 pr-3 font-semibold">Gasto/dia</th>
                <th className="py-1 pr-3 font-semibold">Vendas</th>
                <th className="py-1 pr-3 font-semibold">CPA (95%)</th>
                <th className="py-1 pr-3 font-semibold">ROAS</th>
              </tr>
            </thead>
            <tbody>
              {[
                { label: "7 dias antes", w: o.before },
                { label: "Depois", w: o.after },
              ].map(({ label, w }) => (
                <tr key={label} className="border-t border-border/60">
                  <td className="py-1 pr-3 text-muted">{label}</td>
                  <td className="py-1 pr-3 text-faint">{range(w)}</td>
                  <td className="py-1 pr-3">{fmtBRL(w.spendPerDay)}</td>
                  <td className="py-1 pr-3">{fmtInt(w.purchases)}</td>
                  <td className="py-1 pr-3">{cpaCell(w)}</td>
                  <td className="py-1 pr-3">{fmtRoas(w.roas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <ul className="mt-2 space-y-1 text-xs text-muted">
        <li>{o.evidenceNote}</li>
        {o.followedNote ? (
          <li>
            Seguiu a recomendação?{" "}
            <span className="font-medium text-text">{o.followed === "sim" ? "Aparentemente sim" : o.followed === "parcial" ? "Em parte" : "Aparentemente não"}</span> —{" "}
            {o.followedNote}
          </li>
        ) : null}
        {o.trend ? (
          <li className="inline-flex items-center gap-1">
            <TrendIcon className="h-3.5 w-3.5" />
            Vendas por real gasto {o.trend.direction === "estavel" ? "sem diferença estatística" : o.trend.direction} em relação aos 7 dias antes
            {o.trend.direction !== "estavel" ? ` (p = ${o.trend.pValue.toFixed(3).replace(".", ",")})` : ""}.
          </li>
        ) : null}
        <li className="text-faint">
          Julgado pelo CPA máximo de {fmtBRL(o.targets.maxCpa)} {o.targets.source === "parecer" ? "da época do parecer" : "atual (o parecer não guardou a meta)"}. Só vendas
          principais pagas com origem nesta campanha; “seguiu?” é deduzido só pelo gasto/dia.
        </li>
      </ul>
    </div>
  );
}
