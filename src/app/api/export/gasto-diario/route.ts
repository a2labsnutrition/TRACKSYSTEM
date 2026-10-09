import { spendByDay } from "@/lib/analytics";
import { getRepository } from "@/lib/data";
import { periodFrom } from "@/lib/page";

/** CSV do gasto por dia (separador ; e vírgula decimal, abre direto no Excel pt-BR). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = Object.fromEntries(url.searchParams.entries());
  const repo = await getRepository();
  const ctx = await repo.context();
  const period = periodFrom(params, ctx.workspace.timezone);
  const level = params.nivel === "adset" || params.nivel === "ad" ? params.nivel : "campaign";
  const m = await spendByDay(repo, period, { level, campaignId: params.campanha || undefined });

  const num = (v: number | null | undefined) => (v == null ? "" : v.toFixed(2).replace(".", ","));
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines: string[] = [];
  lines.push(["data", "id", "nome", "nivel", "gasto"].join(";"));
  for (const e of m.entities) for (const d of m.dates) if (e.byDate[d]) lines.push([d, e.id, esc(e.name), level, num(e.byDate[d])].join(";"));
  lines.push("");
  lines.push(["data", "gasto_total", "receita_liquida", "lucro", "vendas_pagas", "cpa_real", "roas_real", "gasto_acumulado", "lucro_acumulado"].join(";"));
  for (const d of m.daily)
    lines.push([d.date, num(d.spend), num(d.revenue), num(d.profit), String(d.purchases), num(d.cpa), num(d.roas), num(d.cumSpend), num(d.cumProfit)].join(";"));

  const body = "﻿" + lines.join("\r\n");
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="gasto-diario_${period.from}_${period.to}.csv"`,
    },
  });
}
