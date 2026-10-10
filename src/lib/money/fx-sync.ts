import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchPtax } from "@/lib/integrations/bcb/ptax";
import { log } from "@/lib/log";
import { addDays, todayIn } from "@/lib/tz";

/**
 * Baixa a PTAX (Banco Central) das moedas das contas de anúncio que não são
 * em R$ e grava em fx_rates. Incremental: começa no dia seguinte à última
 * cotação salva (até 40 dias atrás). Falha não interrompe o sync do Meta —
 * nesse caso vale a taxa manual da conta, ou o gasto fica marcado "sem cotação".
 */
export async function syncFxRates(db: SupabaseClient, fetchImpl: typeof fetch = fetch) {
  const { data: accounts, error } = await db.from("ad_accounts").select("currency").eq("is_active", true);
  if (error) return { ok: false, error: error.message, currencies: [] as string[] };
  const currencies = [...new Set((accounts ?? []).map((a) => String(a.currency ?? "BRL").toUpperCase()))].filter((c) => c !== "BRL");
  const today = todayIn("America/Sao_Paulo");
  const result: Record<string, { saved: number; error?: string }> = {};
  for (const cur of currencies) {
    try {
      const { data: last } = await db.from("fx_rates").select("date").eq("base", cur).eq("quote", "BRL").order("date", { ascending: false }).limit(1);
      const lastDate = last?.[0]?.date ? String(last[0].date).slice(0, 10) : null;
      const from = lastDate && lastDate > addDays(today, -40) ? addDays(lastDate, 1) : addDays(today, -40);
      if (from > today) {
        result[cur] = { saved: 0 };
        continue;
      }
      const rates = await fetchPtax(cur, from, today, fetchImpl);
      if (rates.length) {
        const { error: upErr } = await db
          .from("fx_rates")
          .upsert(rates.map((r) => ({ date: r.date, base: cur, quote: "BRL", rate: r.rate, source: "ptax" })), { onConflict: "date,base,quote" });
        if (upErr) throw new Error(upErr.message);
      }
      result[cur] = { saved: rates.length };
    } catch (e) {
      result[cur] = { saved: 0, error: (e as Error).message };
      log.warn("fx.ptax_failed", { currency: cur, error: e });
    }
  }
  return { ok: Object.values(result).every((r) => !r.error), currencies, result };
}
