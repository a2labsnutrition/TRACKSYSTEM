"use client";

import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtBRL, fmtCompact, fmtDate, fmtDayShort } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface SpendPoint {
  date: string;
  spend: number;
  revenue: number;
  profit: number;
  cumSpend: number;
  cumRevenue: number;
  cumProfit: number;
}

const tooltipStyle = {
  background: "var(--panel-2)",
  border: "1px solid var(--border-strong)",
  borderRadius: 8,
  fontSize: 12,
  color: "var(--text)",
};

export function SpendRevenueChart({ data, height = 280 }: { data: SpendPoint[]; height?: number }) {
  const [cum, setCum] = useState(false);
  const rows = data.map((d) => ({
    date: d.date,
    Gasto: cum ? d.cumSpend : d.spend,
    Faturamento: cum ? d.cumRevenue : d.revenue,
    "Contribuição (est.)": cum ? d.cumProfit : d.profit,
  }));
  return (
    <div>
      <div className="mb-2 flex justify-end gap-1 text-xs">
        {[
          [false, "Por dia"],
          [true, "Acumulado"],
        ].map(([v, label]) => (
          <button
            key={String(label)}
            type="button"
            onClick={() => setCum(v as boolean)}
            className={cn("rounded-md px-2 py-1", cum === v ? "bg-panel-2 text-text" : "text-muted hover:text-text")}
          >
            {label as string}
          </button>
        ))}
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDayShort} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
            <YAxis tickFormatter={(v) => fmtCompact(v)} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
            <Tooltip
              contentStyle={tooltipStyle}
              labelFormatter={(l) => fmtDate(String(l))}
              formatter={(v) => fmtBRL(Number(v))}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} />
            <Bar dataKey="Gasto" fill="var(--chart-spend)" radius={[3, 3, 0, 0]} maxBarSize={22} />
            <Bar dataKey="Faturamento" fill="var(--chart-revenue)" radius={[3, 3, 0, 0]} maxBarSize={22} />
            <Line dataKey="Contribuição (est.)" stroke="var(--chart-profit)" strokeWidth={2} dot={false} type="monotone" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
