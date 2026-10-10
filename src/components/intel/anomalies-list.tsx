import { AlertOctagon, AlertTriangle, CheckCircle2, CircleDashed } from "lucide-react";
import Link from "next/link";
import type { AnomalyCheck } from "@/lib/anomalies";
import { cn } from "@/lib/utils";

/** Anomalias reais em destaque; verificações dentro do normal e sem base ficam recolhidas. */
export function AnomaliesList({ checks, withPeriod }: { checks: AnomalyCheck[]; withPeriod?: (href: string) => string }) {
  const real = checks.filter((c) => c.status === "anomalia");
  const normal = checks.filter((c) => c.status === "normal");
  const noData = checks.filter((c) => c.status === "sem_dados");
  const link = (h?: string) => (h ? (withPeriod ? withPeriod(h) : h) : null);
  return (
    <div className="space-y-2 text-sm">
      {real.length ? (
        real.map((c) => {
          const Icon = c.severity === "critico" ? AlertOctagon : AlertTriangle;
          const href = link(c.href);
          const body = (
            <>
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", c.severity === "critico" ? "text-bad" : "text-warn")} />
              <span className="min-w-0">
                <span className="font-medium">{c.title}</span>
                <span className="block text-xs text-muted">{c.detail}</span>
                <span className="block text-[11px] text-faint">Critério: {c.method}</span>
              </span>
            </>
          );
          const cls = cn("flex gap-2 rounded-lg border px-3 py-2", c.severity === "critico" ? "border-bad/30 bg-bad/5" : "border-warn/30 bg-warn/5");
          return href ? (
            <Link key={c.code} href={href} className={cn(cls, "hover:brightness-110")}>
              {body}
            </Link>
          ) : (
            <div key={c.code} className={cls}>
              {body}
            </div>
          );
        })
      ) : (
        <p className="flex items-center gap-2 text-xs text-good">
          <CheckCircle2 className="h-4 w-4" /> Nenhuma anomalia: as variações estão dentro do ruído esperado.
        </p>
      )}
      {normal.length || noData.length ? (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted">
            {normal.length} verificação(ões) dentro do normal{noData.length ? ` · ${noData.length} sem base suficiente` : ""}
          </summary>
          <ul className="mt-1.5 space-y-1">
            {[...normal, ...noData].map((c) => (
              <li key={c.code} className="flex gap-2">
                {c.status === "normal" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" /> : <CircleDashed className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />}
                <span>
                  <b className="font-medium">{c.title}:</b> <span className="text-muted">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
