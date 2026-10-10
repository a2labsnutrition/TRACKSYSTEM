import type { AdAccount, InsightDaily } from "@/lib/data/types";
import { addDays } from "@/lib/tz";

/**
 * Conversão da moeda da conta de anúncios para BRL.
 *
 * O Meta devolve gasto, valores de conversão e orçamentos na MOEDA DA CONTA.
 * Conta em USD cobrada em cartão brasileiro: o custo real em R$ ≈ cotação × (1 + IOF + spread).
 * Por isso todo valor convertido é marcado como ESTIMADO. Sem cotação disponível,
 * o valor fica na moeda original com `fxMissing` — nunca tratamos US$ como R$.
 */

export const BASE_CURRENCY = "BRL";

/** Cotações por data (YYYY-MM-DD) para uma moeda -> BRL. */
export type FxTable = Map<string, Map<string, number>>; // currency -> date -> rate

export interface FxResult {
  rate: number | null;
  estimated: boolean;
  source: "nativo" | "ptax" | "manual" | "sem_cotacao";
  /** Data da cotação usada (pode ser anterior em fins de semana/feriados). */
  rateDate: string | null;
}

/** Cotação do dia ou a última disponível até 10 dias antes (fins de semana/feriados). */
export function lookupRate(table: FxTable, currency: string, date: string): { rate: number; date: string } | null {
  const byDate = table.get(currency.toUpperCase());
  if (!byDate) return null;
  for (let i = 0; i <= 10; i++) {
    const d = addDays(date, -i);
    const r = byDate.get(d);
    if (r && r > 0) return { rate: r, date: d };
  }
  return null;
}

export function fxFor(account: Pick<AdAccount, "currency" | "fxMode" | "fxManualRate" | "fxSpreadPct"> | undefined, table: FxTable, date: string): FxResult {
  const currency = (account?.currency ?? BASE_CURRENCY).toUpperCase();
  if (currency === BASE_CURRENCY) return { rate: 1, estimated: false, source: "nativo", rateDate: null };
  const spread = 1 + Math.max(0, account?.fxSpreadPct ?? 0.035);
  if (account?.fxMode === "manual" && account.fxManualRate && account.fxManualRate > 0) {
    return { rate: account.fxManualRate * spread, estimated: true, source: "manual", rateDate: null };
  }
  const found = lookupRate(table, currency, date);
  if (found) return { rate: found.rate * spread, estimated: true, source: "ptax", rateDate: found.date };
  if (account?.fxManualRate && account.fxManualRate > 0) {
    return { rate: account.fxManualRate * spread, estimated: true, source: "manual", rateDate: null };
  }
  return { rate: null, estimated: true, source: "sem_cotacao", rateDate: null };
}

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Converte as linhas de insights para BRL (gasto e valor de conversão). */
export function applyFx(rows: InsightDaily[], accounts: Map<string, AdAccount>, table: FxTable): InsightDaily[] {
  return rows.map((r) => {
    const acc = r.adAccountId ? accounts.get(r.adAccountId) : undefined;
    const currency = (acc?.currency ?? BASE_CURRENCY).toUpperCase();
    if (currency === BASE_CURRENCY) return { ...r, currency, fxRate: 1, fxEstimated: false };
    const fx = fxFor(acc, table, r.date);
    if (fx.rate == null) return { ...r, currency, spendOriginal: r.spend, fxRate: null, fxEstimated: true, fxMissing: true };
    return {
      ...r,
      currency,
      spendOriginal: r.spend,
      spend: r2(r.spend * fx.rate),
      purchaseValue: r2(r.purchaseValue * fx.rate),
      fxRate: fx.rate,
      fxEstimated: true,
    };
  });
}

/** Converte um valor (orçamento) com a cotação de uma data. */
export function convertAmount(value: number | null, account: AdAccount | undefined, table: FxTable, date: string): number | null {
  if (value == null) return null;
  const fx = fxFor(account, table, date);
  return fx.rate == null ? null : r2(value * fx.rate);
}

export function fxTableFromRows(rows: Array<{ date: string; base: string; rate: number }>): FxTable {
  const t: FxTable = new Map();
  for (const r of rows) {
    const cur = r.base.toUpperCase();
    if (!t.has(cur)) t.set(cur, new Map());
    t.get(cur)!.set(String(r.date).slice(0, 10), Number(r.rate));
  }
  return t;
}
