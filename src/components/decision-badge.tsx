import { STATUS_LABEL, type DecisionStatus } from "@/lib/decision/rules";
import { cn } from "@/lib/utils";

const STYLE: Record<DecisionStatus, string> = {
  escalar: "bg-good/15 text-good border-good/40",
  manter: "bg-info/10 text-info border-info/30",
  otimizar: "bg-warn/10 text-warn border-warn/40",
  pausar: "bg-bad/15 text-bad border-bad/40",
  aguardar: "bg-panel-2 text-muted border-border-strong",
};

const DOT: Record<DecisionStatus, string> = {
  escalar: "bg-good",
  manter: "bg-info",
  otimizar: "bg-warn",
  pausar: "bg-bad",
  aguardar: "bg-faint",
};

export function DecisionBadge({ status, className, large }: { status: DecisionStatus; className?: string; large?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold",
        large ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-[11px]",
        STYLE[status],
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT[status])} />
      {STATUS_LABEL[status]}
    </span>
  );
}
