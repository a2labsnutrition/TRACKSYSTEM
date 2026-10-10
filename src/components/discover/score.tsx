import { SOURCE_LABEL, type ComponentSource, type NicheScore } from "@/lib/discover/score";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function scoreTone(v: number | null) {
  if (v == null) return "text-faint";
  return v >= 65 ? "text-good" : v >= 45 ? "text-warn" : "text-bad";
}

const SOURCE_TONE: Record<ComponentSource, "good" | "violet" | "neutral" | "warn"> = {
  medido: "good",
  estimativa_ia: "violet",
  catalogo: "neutral",
  sem_dados: "warn",
};

/** Componentes do score com o peso e a origem de cada um. */
export function ScoreBreakdown({ score }: { score: NicheScore }) {
  return (
    <ul className="space-y-3">
      {score.components.map((c) => {
        const contrib = c.value == null ? null : c.inverse ? 100 - c.value : c.value;
        return (
          <li key={c.key}>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="font-medium">
                {c.inverse ? "− " : "+ "}
                {c.label} <span className="text-xs font-normal text-faint">({Math.round(c.weight * 100)}%)</span>
              </span>
              <span className="flex items-center gap-2">
                <Badge tone={SOURCE_TONE[c.source]}>{SOURCE_LABEL[c.source]}</Badge>
                <span className={cn("tabular w-8 text-right font-semibold", scoreTone(contrib))}>{c.value ?? "—"}</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-panel-2">
              {c.value != null ? <div className={cn("h-full rounded-full", c.inverse ? "bg-warn" : "bg-primary")} style={{ width: `${c.value}%` }} /> : null}
            </div>
            <p className="mt-1 text-xs text-muted">{c.detail}</p>
          </li>
        );
      })}
    </ul>
  );
}
