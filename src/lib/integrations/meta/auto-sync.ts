import "server-only";
import { runAlertsForWorkspace } from "@/lib/alerts/run";
import { isServiceRoleConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { runSyncCycle } from "./sync";

/**
 * Sincronização ao abrir o painel: se o último sync passou de 1 h, roda um ciclo
 * em segundo plano (depois da resposta). Mantém os dados frescos sem depender de
 * agendamento de hora em hora (indisponível no plano Hobby da Vercel).
 */

const STALE_MS = 60 * 60_000;
const COOLDOWN_MS = 10 * 60_000;
const lastTrigger = new Map<string, number>();

export function needsAutoSync(accounts: Array<{ lastSyncedAt: string | null }>, now = Date.now()): boolean {
  return accounts.some((a) => !a.lastSyncedAt || now - new Date(a.lastSyncedAt).getTime() > STALE_MS);
}

export async function autoSyncWorkspace(workspaceId: string, now = Date.now()): Promise<void> {
  if (!isServiceRoleConfigured()) return;
  // Evita disparos repetidos (várias páginas abertas, recarregamentos)
  if (now - (lastTrigger.get(workspaceId) ?? 0) < COOLDOWN_MS) return;
  lastTrigger.set(workspaceId, now);
  const db = supabaseAdmin();
  try {
    // Outra instância sincronizou há pouco?
    const { data } = await db
      .from("sync_jobs")
      .select("created_at")
      .eq("workspace_id", workspaceId)
      .in("kind", ["meta_hourly", "meta_daily"])
      .order("created_at", { ascending: false })
      .limit(1);
    const last = data?.[0]?.created_at ? new Date(data[0].created_at as string).getTime() : 0;
    if (now - last < COOLDOWN_MS) return;
    const r = await runSyncCycle(db, "hourly", { workspaceId, timeBudgetMs: 25_000 });
    await runAlertsForWorkspace(db, workspaceId);
    log.info("sync.auto", { workspaceId, accounts: r.accounts, errors: r.errors.length });
  } catch (e) {
    log.warn("sync.auto_failed", { workspaceId, error: e });
  }
}
