import { CONFIDENCE_NOTE, type ConfidenceAssessment } from "@/lib/stats/confidence";
import { cn } from "@/lib/utils";
import { ConfidenceBadge } from "./recommendation-card";

const LEVEL_CLS = { baixa: "text-warn", moderada: "text-info", alta: "text-good", "n/a": "text-faint" } as const;

/** Critérios transparentes da confiança (nível final = o pior critério aplicável). */
export function ConfidencePanel({ a }: { a: ConfidenceAssessment }) {
  if (!a.criteria.length) return null;
  return (
    <details className="rounded-lg border border-border bg-bg/40 px-3 py-2 text-xs">
      <summary className="flex cursor-pointer flex-wrap items-center gap-2">
        <ConfidenceBadge level={a.level} />
        <span className="text-muted">{a.summary}</span>
      </summary>
      <table className="mt-2 w-full">
        <thead>
          <tr className="text-left text-faint">
            <th className="py-1 pr-2 font-medium">Critério</th>
            <th className="py-1 pr-2 font-medium">Valor</th>
            <th className="py-1 pr-2 font-medium">Nível</th>
            <th className="hidden py-1 font-medium md:table-cell">Regra</th>
          </tr>
        </thead>
        <tbody>
          {a.criteria.map((c) => (
            <tr key={c.key} className="border-t border-border align-top">
              <td className="py-1 pr-2">{c.label}</td>
              <td className="py-1 pr-2 tabular text-muted">{c.value}</td>
              <td className={cn("py-1 pr-2 font-semibold", LEVEL_CLS[c.level])}>{c.level}</td>
              <td className="hidden py-1 text-faint md:table-cell">{c.rule}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-faint">{CONFIDENCE_NOTE} Nível final = o critério mais fraco.</p>
    </details>
  );
}
