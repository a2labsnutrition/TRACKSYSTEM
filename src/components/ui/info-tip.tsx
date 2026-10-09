"use client";

import { Info } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { METRICS } from "@/lib/metrics/definitions";
import { cn } from "@/lib/utils";

/** Tooltip que funciona com hover (desktop) e toque (celular). */
export function InfoTip({ metric, text, className }: { metric?: string; text?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const def = metric ? METRICS[metric] : null;

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("touchstart", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("touchstart", close);
    };
  }, [open]);

  if (!def && !text) return null;
  return (
    <span
      ref={ref}
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        aria-label="O que é isso?"
        onClick={() => setOpen((v) => !v)}
        className="text-faint hover:text-muted"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      {open ? (
        <span className="absolute left-1/2 top-5 z-50 w-64 -translate-x-1/2 rounded-lg border border-border-strong bg-panel-2 p-3 text-left text-xs font-normal normal-case tracking-normal text-text shadow-xl">
          {def ? (
            <>
              <span className="block font-semibold">{def.label}</span>
              <span className="mt-1 block text-muted">{def.what}</span>
              <span className="mt-2 block">
                <span className="font-medium text-warn">Quando está ruim: </span>
                {def.whenBad}
              </span>
            </>
          ) : (
            <span className="block text-muted">{text}</span>
          )}
        </span>
      ) : null}
    </span>
  );
}
