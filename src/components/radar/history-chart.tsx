"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { fmtCompact, fmtDate, fmtDayShort, fmtInt } from "@/lib/format";

export interface RadarPoint {
  date: string;
  viewsPerDay: number;
  channels: number;
}

/** Demanda diária (views/dia dos vídeos recentes) de um subnicho. */
export function RadarHistoryChart({ data }: { data: RadarPoint[] }) {
  if (data.length < 2) return <p className="py-6 text-center text-xs text-faint">O gráfico aparece a partir da 2ª medição diária.</p>;
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tickFormatter={fmtDayShort} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={16} />
          <YAxis tickFormatter={(v: number) => fmtCompact(v)} tick={{ fill: "var(--muted)", fontSize: 11 }} axisLine={false} tickLine={false} width={48} />
          <Tooltip
            contentStyle={{ background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            labelFormatter={(l) => fmtDate(String(l))}
            formatter={(v, name) => [fmtInt(Number(v)), name === "viewsPerDay" ? "views/dia" : "canais"]}
          />
          <Line type="monotone" dataKey="viewsPerDay" stroke="var(--info)" strokeWidth={2} dot={{ r: 2 }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
