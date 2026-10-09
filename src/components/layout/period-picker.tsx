"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { PERIOD_LABELS, type PeriodKey } from "@/lib/tz";
import { cn } from "@/lib/utils";

const KEYS: PeriodKey[] = ["today", "yesterday", "7d", "14d", "30d", "custom"];

export function PeriodPicker({ current, from, to }: { current: PeriodKey; from: string; to: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);

  const go = (key: PeriodKey, extra?: Record<string, string>) => {
    const p = new URLSearchParams(params.toString());
    p.set("p", key);
    if (key !== "custom") {
      p.delete("from");
      p.delete("to");
    }
    for (const [k, v] of Object.entries(extra ?? {})) p.set(k, v);
    start(() => router.push(`${pathname}?${p.toString()}`));
  };

  return (
    <div className={cn("flex min-w-0 max-w-full flex-wrap items-center gap-2", pending && "opacity-60")}>
      <div className="flex max-w-full overflow-x-auto rounded-lg border border-border bg-panel p-0.5">
        {KEYS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => (k === "custom" ? go("custom", { from: f, to: t }) : go(k))}
            className={cn(
              "whitespace-nowrap rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
              current === k ? "bg-primary text-white" : "text-muted hover:text-text",
            )}
          >
            {PERIOD_LABELS[k]}
          </button>
        ))}
      </div>
      {current === "custom" ? (
        <div className="flex items-center gap-1 text-xs">
          <input type="date" value={f} onChange={(e) => setF(e.target.value)} className="h-8 rounded-md border border-border-strong bg-bg px-2 text-text" />
          <span className="text-faint">até</span>
          <input type="date" value={t} onChange={(e) => setT(e.target.value)} className="h-8 rounded-md border border-border-strong bg-bg px-2 text-text" />
          <button type="button" onClick={() => go("custom", { from: f, to: t })} className="h-8 rounded-md bg-panel-2 px-2 text-text hover:bg-border">
            Aplicar
          </button>
        </div>
      ) : null}
    </div>
  );
}
