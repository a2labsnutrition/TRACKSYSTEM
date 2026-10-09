"use client";

import { ArrowDown, ArrowUp, Columns3, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { DecisionStatus } from "@/lib/decision/rules";
import { fmtBRL, fmtDec, fmtInt, fmtPct, fmtRoas } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DecisionBadge } from "./decision-badge";
import { CopyButton } from "./ui/copy-button";
import { Input, Select } from "./ui/input";
import { Table, TableWrap, Td, Th } from "./ui/table";

export interface CampaignTableRow {
  id: string;
  name: string;
  active: boolean;
  status: DecisionStatus;
  headline: string;
  budget: string;
  spend: number;
  revenue: number;
  profit: number;
  purchases: number;
  metaPurchases: number;
  cpa: number | null;
  roas: number | null;
  ctr: number | null;
  cpm: number | null;
  connectRate: number | null;
  frequency: number | null;
  hookRate: number | null;
  w1: { spend: number; purchases: number; cpa: number | null; roas: number | null };
  w3: { spend: number; purchases: number; cpa: number | null; roas: number | null };
  w7: { spend: number; purchases: number; cpa: number | null; roas: number | null };
}

type ColKey =
  | "budget" | "spend" | "revenue" | "profit" | "purchases" | "metaPurchases" | "cpa" | "roas"
  | "ctr" | "cpm" | "connectRate" | "frequency" | "hookRate" | "windows";

const COLS: Record<ColKey, { label: string; num?: (r: CampaignTableRow) => number | null; render: (r: CampaignTableRow) => React.ReactNode }> = {
  budget: { label: "Orçamento", render: (r) => <span className="text-muted">{r.budget}</span> },
  spend: { label: "Gasto", num: (r) => r.spend, render: (r) => fmtBRL(r.spend) },
  revenue: { label: "Receita líq.", num: (r) => r.revenue, render: (r) => fmtBRL(r.revenue) },
  profit: {
    label: "Lucro",
    num: (r) => r.profit,
    render: (r) => <span className={r.profit < 0 ? "text-bad" : r.profit > 0 ? "text-good" : ""}>{fmtBRL(r.profit)}</span>,
  },
  purchases: { label: "Vendas", num: (r) => r.purchases, render: (r) => fmtInt(r.purchases) },
  metaPurchases: { label: "Compras Meta", num: (r) => r.metaPurchases, render: (r) => fmtInt(r.metaPurchases) },
  cpa: { label: "CPA real", num: (r) => r.cpa, render: (r) => fmtBRL(r.cpa) },
  roas: { label: "ROAS real", num: (r) => r.roas, render: (r) => fmtRoas(r.roas) },
  ctr: { label: "CTR link", num: (r) => r.ctr, render: (r) => fmtPct(r.ctr, 2) },
  cpm: { label: "CPM", num: (r) => r.cpm, render: (r) => fmtBRL(r.cpm) },
  connectRate: {
    label: "Connect",
    num: (r) => r.connectRate,
    render: (r) => <span className={r.connectRate != null && r.connectRate < 0.75 ? "text-bad" : ""}>{fmtPct(r.connectRate, 0)}</span>,
  },
  frequency: {
    label: "Freq.",
    num: (r) => r.frequency,
    render: (r) => <span className={r.frequency != null && r.frequency > 2.5 ? "text-warn" : ""}>{fmtDec(r.frequency, 2)}</span>,
  },
  hookRate: { label: "Hook", num: (r) => r.hookRate, render: (r) => fmtPct(r.hookRate, 0) },
  windows: {
    label: "1d · 3d · 7d (CPA / ROAS)",
    render: (r) => (
      <span className="inline-flex gap-3 text-xs">
        {[r.w1, r.w3, r.w7].map((w, i) => (
          <span key={i} className="flex flex-col leading-tight">
            <span>{fmtBRL(w.cpa)}</span>
            <span className="text-faint">{fmtRoas(w.roas)} · {w.purchases}v</span>
          </span>
        ))}
      </span>
    ),
  },
};

const DEFAULT_COLS: ColKey[] = ["spend", "revenue", "profit", "purchases", "cpa", "roas", "ctr", "connectRate", "frequency", "windows"];
const STORAGE_KEY = "cc_campaign_cols";
const STATUS_ORDER: Record<DecisionStatus, number> = { pausar: 0, otimizar: 1, escalar: 2, manter: 3, aguardar: 4 };

export function CampaignsTable({ rows, periodQuery }: { rows: CampaignTableRow[]; periodQuery: string }) {
  const [cols, setCols] = useState<ColKey[]>(DEFAULT_COLS);
  const [showCols, setShowCols] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<"" | DecisionStatus>("");
  const [onlyActive, setOnlyActive] = useState(true);
  const [sort, setSort] = useState<{ key: ColKey | "status" | "name"; dir: 1 | -1 }>({ key: "spend", dir: -1 });

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
      if (Array.isArray(saved)) setCols(saved.filter((c) => c in COLS));
    } catch {
      /* ignora */
    }
  }, []);
  const saveCols = (next: ColKey[]) => {
    setCols(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignora */
    }
  };

  const filtered = useMemo(() => {
    let out = rows.filter(
      (r) => (!q || r.name.toLowerCase().includes(q.toLowerCase())) && (!status || r.status === status) && (!onlyActive || r.active || r.spend > 0),
    );
    out = [...out].sort((a, b) => {
      if (sort.key === "status") return (STATUS_ORDER[a.status] - STATUS_ORDER[b.status]) * sort.dir;
      if (sort.key === "name") return a.name.localeCompare(b.name) * sort.dir;
      const f = COLS[sort.key].num;
      if (!f) return 0;
      const va = f(a);
      const vb = f(b);
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      return (va - vb) * sort.dir;
    });
    return out;
  }, [rows, q, status, onlyActive, sort]);

  const header = (key: ColKey | "status" | "name", label: string, sortable = true, right = true) => (
    <Th className={cn(right && "text-right", sortable && "cursor-pointer select-none hover:text-text")} onClick={() => sortable && setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : -1 }))}>
      <span className="inline-flex items-center gap-1">
        {label}
        {sort.key === key ? sort.dir === 1 ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" /> : null}
      </span>
    </Th>
  );

  const names = filtered.map((r) => r.name).join("\n");

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-faint" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar campanha" className="w-56 pl-8" />
        </div>
        <Select value={status} onChange={(e) => setStatus(e.target.value as DecisionStatus | "")}>
          <option value="">Todos os vereditos</option>
          <option value="escalar">Escalar</option>
          <option value="manter">Manter</option>
          <option value="otimizar">Otimizar</option>
          <option value="pausar">Pausar</option>
          <option value="aguardar">Aguardar dados</option>
        </Select>
        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />
          Só ativas ou com gasto
        </label>
        <div className="ml-auto flex items-center gap-2">
          <CopyButton text={names} label="Copiar nomes" />
          <div className="relative">
            <button type="button" onClick={() => setShowCols((v) => !v)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border-strong bg-panel-2 px-3 text-xs hover:bg-border">
              <Columns3 className="h-3.5 w-3.5" /> Colunas
            </button>
            {showCols ? (
              <div className="absolute right-0 top-9 z-40 w-56 rounded-lg border border-border-strong bg-panel-2 p-2 shadow-xl">
                {(Object.keys(COLS) as ColKey[]).map((k) => (
                  <label key={k} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-border">
                    <input
                      type="checkbox"
                      checked={cols.includes(k)}
                      onChange={(e) => saveCols(e.target.checked ? (Object.keys(COLS) as ColKey[]).filter((c) => c === k || cols.includes(c)) : cols.filter((c) => c !== k))}
                    />
                    {COLS[k].label}
                  </label>
                ))}
                <button type="button" className="mt-1 w-full rounded px-2 py-1 text-left text-xs text-primary hover:bg-border" onClick={() => saveCols(DEFAULT_COLS)}>
                  Restaurar padrão
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <TableWrap>
        <Table>
          <thead>
            <tr>
              {header("status", "Veredito", true, false)}
              {header("name", "Campanha", true, false)}
              {cols.map((c) => header(c, COLS[c].label, Boolean(COLS[c].num)))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="hover:bg-panel-2/50">
                <Td>
                  <DecisionBadge status={r.status} />
                </Td>
                <Td className="max-w-80">
                  <Link href={`/campanhas/${r.id}?${periodQuery}`} className="block truncate font-medium hover:text-primary" title={r.name}>
                    {r.name}
                  </Link>
                  <span className="block max-w-80 truncate text-xs text-muted" title={r.headline}>
                    {!r.active ? "Pausada · " : ""}
                    {r.headline}
                  </span>
                </Td>
                {cols.map((c) => (
                  <Td key={c} className="text-right">
                    {COLS[c].render(r)}
                  </Td>
                ))}
              </tr>
            ))}
          </tbody>
        </Table>
      </TableWrap>
      {!filtered.length ? <p className="p-6 text-center text-sm text-muted">Nenhuma campanha com esses filtros.</p> : null}
    </div>
  );
}
