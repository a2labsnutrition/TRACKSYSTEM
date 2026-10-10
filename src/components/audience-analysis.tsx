"use client";

import { useState } from "react";
import type { AudienceTable, SegmentTag } from "@/lib/audience";
import { AUDIENCE_TABS } from "@/lib/audience";
import { fmtBRL, fmtInt, fmtPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "./ui/badge";
import { Table, TableWrap, Td, Th } from "./ui/table";

const TAG: Record<Exclude<SegmentTag, null>, { label: string; tone: "good" | "bad" | "warn" }> = {
  barato: { label: "Converte barato", tone: "good" },
  caro: { label: "Caro", tone: "warn" },
  queima: { label: "Queima dinheiro", tone: "bad" },
};

export function AudienceAnalysis({ tables }: { tables: AudienceTable[] }) {
  const [tab, setTab] = useState(tables[0]?.tab ?? "age");
  const t = tables.find((x) => x.tab === tab);
  const maxSpend = Math.max(1, ...(t?.segments.map((s) => s.spend) ?? [1]));
  return (
    <div>
      <div className="flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
        {AUDIENCE_TABS.map((x) => {
          const tbl = tables.find((y) => y.tab === x.key);
          const flagged = tbl?.segments.some((s) => s.tag === "queima") ?? false;
          return (
            <button
              key={x.key}
              type="button"
              onClick={() => setTab(x.key)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1 rounded-md px-2.5 py-1 text-xs",
                tab === x.key ? "bg-primary text-white" : "text-muted hover:bg-panel-2 hover:text-text",
              )}
            >
              {x.label}
              {flagged ? <span className="h-1.5 w-1.5 rounded-full bg-bad" /> : null}
            </button>
          );
        })}
      </div>
      {t && t.segments.length ? (
        <TableWrap className="max-h-[480px]">
          <Table>
            <thead>
              <tr>
                <Th>Segmento</Th>
                <Th className="min-w-40">Gasto</Th>
                <Th className="text-right">Compras</Th>
                <Th className="text-right">CPA</Th>
                <Th className="text-right">CTR</Th>
                <Th className="text-right">CPM</Th>
                <Th className="text-right">Connect</Th>
                <Th>Sinal</Th>
              </tr>
            </thead>
            <tbody>
              {t.segments.map((s) => (
                <tr key={s.value} className="hover:bg-panel-2/50">
                  <Td className="font-medium">{s.label}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <div className="h-2 w-24 overflow-hidden rounded-full bg-panel-2">
                        <div
                          className={cn("h-full rounded-full", s.tag === "queima" ? "bg-bad" : s.tag === "barato" ? "bg-good" : "bg-primary")}
                          style={{ width: `${(s.spend / maxSpend) * 100}%` }}
                        />
                      </div>
                      <span className="tabular text-xs">
                        {fmtBRL(s.spend)} <span className="text-faint">({fmtPct(s.spendShare, 0)})</span>
                      </span>
                    </div>
                  </Td>
                  <Td className="text-right">
                    {fmtInt(s.purchases)} <span className="text-xs text-faint">({fmtPct(s.purchaseShare, 0)})</span>
                  </Td>
                  <Td className={cn("text-right font-medium", s.tag === "barato" && "text-good", (s.tag === "caro" || s.tag === "queima") && "text-bad")}>
                    {fmtBRL(s.cpa)}
                  </Td>
                  <Td className="text-right">{fmtPct(s.ctr, 2)}</Td>
                  <Td className="text-right">{fmtBRL(s.cpm)}</Td>
                  <Td className="text-right">{fmtPct(s.connectRate, 0)}</Td>
                  <Td>{s.tag ? <Badge tone={TAG[s.tag].tone}>{TAG[s.tag].label}</Badge> : null}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
      ) : (
        <p className="p-6 text-center text-sm text-muted">Sem dados deste detalhamento no período.</p>
      )}
      {t ? (
        <p className="border-t border-border px-4 py-2 text-[11px] text-faint">
          CPA médio do detalhamento: {fmtBRL(t.avgCpa)} · Compras = atribuídas pelo Meta (a Cakto não informa idade, gênero ou posicionamento).
          {tab === "region" ? " Algumas regiões podem vir sem compras por limitação de privacidade do Meta." : ""}
        </p>
      ) : null}
    </div>
  );
}
