import Link from "next/link";
import { ACTION_LABEL, type Recommendation } from "@/lib/decision/rules";
import type { ConfidenceLevel } from "@/lib/stats/confidence";
import { cn } from "@/lib/utils";
import { Badge, type Tone } from "@/components/ui/badge";

const ACTION_TONE: Record<Recommendation["action"], Tone> = {
  aumentar_gradual: "good",
  escala_horizontal: "good",
  manter: "info",
  variacoes_criativo: "violet",
  reduzir: "warn",
  pausar: "bad",
  aguardar: "neutral",
  corrigir_tracking: "bad",
  otimizar_funil: "warn",
};

export const CONFIDENCE_TONE: Record<ConfidenceLevel, Tone> = { baixa: "warn", moderada: "info", alta: "good" };

export function ConfidenceBadge({ level }: { level: ConfidenceLevel }) {
  return (
    <Badge tone={CONFIDENCE_TONE[level]} title="Quanto os dados sustentam a conclusão — não é a chance de dar certo">
      Confiança {level}
    </Badge>
  );
}

/**
 * Recomendação consultiva com os elementos exigidos: ação, dados que justificam,
 * confiança, riscos, impacto estimado, o que invalida e quando reavaliar —
 * mais "Ver dados e cálculos".
 */
export function RecommendationCard({ rec, campaignName, href, compact }: { rec: Recommendation; campaignName?: string; href?: string; compact?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-bg/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={ACTION_TONE[rec.action]}>{ACTION_LABEL[rec.action]}</Badge>
        <ConfidenceBadge level={rec.confidence} />
        {campaignName ? (
          href ? (
            <Link href={href} className="min-w-0 truncate text-xs text-muted hover:text-text hover:underline">
              {campaignName}
            </Link>
          ) : (
            <span className="min-w-0 truncate text-xs text-muted">{campaignName}</span>
          )
        ) : null}
      </div>
      <p className="mt-1.5 font-medium">{rec.title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-muted">
        {(compact ? rec.justification.slice(0, 2) : rec.justification).map((j, i) => (
          <li key={i}>{j}</li>
        ))}
      </ul>
      {rec.impact ? <p className="mt-1.5 text-xs"><b>Impacto estimado:</b> {rec.impact.text}</p> : null}
      {!compact ? (
        <div className="mt-2 grid grid-cols-1 gap-2 text-xs md:grid-cols-3">
          <Block title="Riscos" items={rec.risks} />
          <Block title="Invalida se" items={rec.invalidation} />
          <Block title="Reavaliar" items={[rec.reassess]} />
        </div>
      ) : (
        <p className="mt-1 text-[11px] text-faint">Reavaliar: {rec.reassess}</p>
      )}
      {rec.calc.length ? (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-primary">Ver dados e cálculos</summary>
          <table className="mt-1.5 w-full">
            <tbody>
              {rec.calc.map((c, i) => (
                <tr key={i} className="border-t border-border align-top">
                  <td className="py-1 pr-2 font-medium">{c.label}</td>
                  <td className="py-1 pr-2 text-muted">{c.formula}</td>
                  <td className="py-1 text-right tabular">{c.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ) : null}
    </div>
  );
}

function Block({ title, items }: { title: string; items: string[] }) {
  if (!items.filter(Boolean).length) return null;
  return (
    <div className={cn("rounded-md border border-border bg-panel px-2 py-1.5")}>
      <p className="mb-0.5 font-semibold text-muted">{title}</p>
      <ul className="space-y-0.5 text-muted">
        {items.filter(Boolean).map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}
