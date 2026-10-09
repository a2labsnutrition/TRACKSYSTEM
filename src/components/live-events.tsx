"use client";

import { Pause, Play } from "lucide-react";
import { useEffect, useState } from "react";
import type { TrackingEvent } from "@/lib/data/types";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";

const COLORS: Record<string, string> = {
  PageView: "text-info",
  ViewContent: "text-primary",
  InitiateCheckout: "text-good",
  AddPaymentInfo: "text-good",
  Lead: "text-violet",
};

/** Lista de eventos que atualiza a cada 3 s. */
export function LiveEvents({ className }: { className?: string }) {
  const [events, setEvents] = useState<TrackingEvent[]>([]);
  const [running, setRunning] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!running) return;
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/tracking/live", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as { events: TrackingEvent[] };
        if (alive) {
          setEvents(json.events);
          setError(null);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    load();
    const t = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [running]);

  return (
    <div className={className}>
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs text-muted">
        <span className={cn("h-2 w-2 rounded-full", running ? "animate-pulse bg-good" : "bg-faint")} />
        {running ? "Ao vivo" : "Pausado"}
        {error ? <span className="text-bad">· erro: {error}</span> : null}
        <button type="button" onClick={() => setRunning((v) => !v)} className="ml-auto inline-flex items-center gap-1 hover:text-text">
          {running ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
          {running ? "Pausar" : "Retomar"}
        </button>
      </div>
      <ul className="max-h-[440px] divide-y divide-border overflow-y-auto">
        {events.map((e) => (
          <li key={`${e.id}-${e.eventId}`} className="flex items-start gap-3 px-4 py-2 text-xs">
            <span className="w-16 shrink-0 tabular text-faint">{new Date(e.createdAt).toLocaleTimeString("pt-BR")}</span>
            <span className="min-w-0 flex-1">
              <span className={cn("font-semibold", COLORS[e.eventName] ?? "text-muted")}>{e.eventName}</span>
              <span className="block truncate text-faint" title={e.url ?? ""}>{e.url}</span>
              <span className="mt-0.5 flex flex-wrap gap-1">
                {e.utmCampaign ? <Badge>utm ✓</Badge> : <Badge tone="warn">sem UTM</Badge>}
                {e.hasFbp ? <Badge>fbp</Badge> : null}
                {e.hasFbc ? <Badge>fbc</Badge> : null}
                {e.capiStatus === "sent" ? <Badge tone="good">CAPI ✓</Badge> : e.capiStatus === "failed" ? <Badge tone="bad">CAPI falhou</Badge> : e.capiStatus === "skipped" ? <Badge>CAPI off</Badge> : null}
              </span>
            </span>
          </li>
        ))}
        {!events.length ? <li className="px-4 py-6 text-center text-sm text-muted">Aguardando eventos…</li> : null}
      </ul>
    </div>
  );
}
