import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_NOTIFY, type WorkspaceContext } from "@/lib/data/types";
import { SupabaseRepository } from "./repo";

/** Repositório de um workspace usando a service role (cron/jobs sem usuário logado). */
export async function adminRepository(db: SupabaseClient, workspaceId: string): Promise<SupabaseRepository | null> {
  const { data: w } = await db.from("workspaces").select("id, name, timezone, currency, tax_rate, default_fee_rate, notify").eq("id", workspaceId).maybeSingle();
  if (!w) return null;
  const { data: accounts } = await db
    .from("ad_accounts")
    .select("id, meta_account_id, name, currency, timezone, account_status, last_synced_at, fx_mode, fx_manual_rate, fx_spread_pct")
    .eq("workspace_id", workspaceId)
    .eq("is_active", true);
  const ctx: WorkspaceContext = {
    mode: "live",
    userEmail: null,
    workspace: {
      id: w.id,
      name: w.name,
      timezone: w.timezone,
      currency: w.currency,
      taxRate: Number(w.tax_rate ?? 0),
      defaultFeeRate: Number(w.default_fee_rate ?? 0.0699),
      notify: { ...DEFAULT_NOTIFY, ...(w.notify ?? {}) },
    },
    adAccounts: (accounts ?? []).map((a) => ({
      id: a.id,
      metaAccountId: a.meta_account_id,
      name: a.name,
      currency: a.currency,
      timezone: a.timezone,
      status: a.account_status ?? "",
      lastSyncedAt: a.last_synced_at,
      fxMode: a.fx_mode === "manual" ? ("manual" as const) : ("auto" as const),
      fxManualRate: a.fx_manual_rate == null ? null : Number(a.fx_manual_rate),
      fxSpreadPct: a.fx_spread_pct == null ? 0.035 : Number(a.fx_spread_pct),
    })),
  };
  return new SupabaseRepository(db, ctx);
}
