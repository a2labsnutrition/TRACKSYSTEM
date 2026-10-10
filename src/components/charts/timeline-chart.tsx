"use client";

import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtBRL, fmtDate, fmtDayShort, fmtDec, fmtPct, fmtRoas } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface TimelinePoint {
  date: string;
  spend: number;
  cpa: number | null;
  roas: number | null;
  ctr: number | null;
  cpm: number | null;
  frequency: number | null;
}

export interface Marker {
  date: string;
  label: string;
  kind: "nota" | "criativo" | "orcamento" | "aprendizado";
}

const MARKER_COLOR: Record<Marker["kind"], string> = {
  nota: "var(--warn)",
  criativo: "var(--violet)",
  orcamento: "var(--info)",
  aprendizado: "var(--good)",
};

const METRICS = {
  spend: { label: "Gasto", color: "var(--chart-spend)", fmt: (v: number) => fmtBRL(v) },
  cpa: { label: "CPA real", color: "var(--warn)", fmt: (v: number) => fmtBRL(v) },
  roas: { label: "ROAS real", color: "var(--good)", fmt: (v: number) => fmtRoas(v) },
  ctr: { label: "CTR link", color: "var(--info)", fmt: (v: number) => fmtPct(v, 2) },
  cpm: { label: "CPM", color: "var(--violet)", fmt: (v: number) => fmtBRL(v) },
  frequency: { label: "Frequência", color: "var(--bad)", fmt: (v: number) => fmtDec(v, 2) },
} as const;

type Key = keyof typeof METRICS;

export function TimelineChart({ data, markers = [] }: { data: TimelinePoint[]; markers?: Marker[] }) {
  const [metric, setMetric] = useState<Key>("cpa");
  const m = METRICS[metric];
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1">
        {(Object.keys(METRICS) as Key[]).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setMetric(k)}
            className={cn(
              "rounded-md border px-2 py-1 text-xs",
              metric === k ? "border-border-strong bg-panel-2 text-text" : "border-transparent text-muted hover:text-text",
            )}
          >
            <span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: METRICS[k].color }} />
            {METRICS[k].label}
          </button>
        ))}
      </div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDayShort} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
            <YAxis tickFormatter={(v) => (metric === "ctr" ? fmtPct(v, 1) : fmtDec(v, metric === "frequency" || metric === "roas" ? 1 : 0))} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
            <Tooltip
              contentStyle={{ background: "var(--panel-2)", border: "1px solid var(--border-strong)", borderRadius: 8, fontSize: 12 }}
              labelFormatter={(l) => {
                const ms = markers.filter((x) => x.date === l);
                return `${fmtDate(String(l))}${ms.length ? ` — ${ms.map((x) => x.label).join("; ")}` : ""}`;
              }}
              formatter={(v) => [v == null ? "—" : m.fmt(Number(v)), m.label]}
            />
            {markers.map((mk, i) => (
              <ReferenceLine key={i} x={mk.date} stroke={MARKER_COLOR[mk.kind]} strokeDasharray="3 3" />
            ))}
            <Line dataKey={metric} stroke={m.color} strokeWidth={2} dot={{ r: 2 }} connectNulls type="monotone" />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {markers.length ? (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          {markers.slice(-10).map((mk, i) => (
            <span key={i}>
              <span style={{ color: MARKER_COLOR[mk.kind] }}>┆</span> {fmtDate(mk.date)}: {mk.label}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
