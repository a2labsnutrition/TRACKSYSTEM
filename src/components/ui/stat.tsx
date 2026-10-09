import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { delta, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { InfoTip } from "./info-tip";

/**
 * KPI com número grande e variação vs. período anterior.
 * `higherIsBetter=false` inverte as cores (ex.: CPA, gasto).
 */
export function Stat({
  label,
  metric,
  value,
  current,
  previous,
  higherIsBetter = true,
  neutral = false,
  sub,
  className,
}: {
  label: string;
  metric?: string;
  value: string;
  current?: number | null;
  previous?: number | null;
  higherIsBetter?: boolean;
  neutral?: boolean;
  sub?: React.ReactNode;
  className?: string;
}) {
  const d = current !== undefined && previous !== undefined ? delta(current ?? null, previous ?? null) : null;
  const good = d == null ? null : neutral ? null : (d > 0) === higherIsBetter;
  const Icon = d == null || Math.abs(d) < 0.005 ? Minus : d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <div className={cn("rounded-xl border border-border bg-panel p-4", className)}>
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {label}
        {metric ? <InfoTip metric={metric} /> : null}
      </div>
      <div className="mt-1.5 whitespace-nowrap text-xl font-semibold tracking-tight tabular sm:text-2xl">{value}</div>
      <div className="mt-1 flex items-center gap-2 text-xs">
        {d != null ? (
          <span
            className={cn(
              "inline-flex items-center gap-0.5 font-medium tabular",
              good == null ? "text-muted" : good ? "text-good" : "text-bad",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {fmtPct(Math.abs(d))}
          </span>
        ) : previous !== undefined ? (
          <span className="text-faint">sem base</span>
        ) : null}
        {sub ? <span className="truncate text-faint">{sub}</span> : null}
      </div>
    </div>
  );
}
