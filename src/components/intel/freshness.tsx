import type { Freshness, FxStatus } from "@/lib/analytics";
import { fmtRelative } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Atualização de cada fonte de dados + situação do câmbio. */
export function FreshnessList({ items, fx }: { items: Freshness[]; fx: FxStatus }) {
  return (
    <ul className="space-y-1.5 text-xs">
      {items.map((f) => (
        <li key={f.label} className="flex items-start gap-2" title={f.rule}>
          <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", f.status === "ok" ? "bg-good" : f.status === "atrasado" ? "bg-warn" : "bg-faint")} />
          <span className="min-w-0 flex-1">{f.label}</span>
          <span className={cn("tabular", f.status === "atrasado" ? "text-warn" : "text-muted")}>{f.at ? fmtRelative(f.at) : "nunca"}</span>
        </li>
      ))}
      <li className="flex items-start gap-2">
        <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", fx.missing ? "bg-bad" : fx.estimated ? "bg-warn" : "bg-good")} />
        <span className="min-w-0 flex-1">Moeda do gasto</span>
        <span className={cn(fx.missing ? "text-bad" : "text-muted")}>
          {fx.missing ? "sem cotação (excluído)" : fx.estimated ? `${fx.currencies.filter((c) => c !== "BRL").join("/")} → R$ estimado` : "R$ (sem conversão)"}
        </span>
      </li>
    </ul>
  );
}
