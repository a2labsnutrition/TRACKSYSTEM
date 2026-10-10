import { env, isServiceRoleConfigured } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { runAlertsForWorkspace } from "@/lib/alerts/run";
import { retryFailedCapi } from "@/lib/ingest/capi-retry";
import { runSyncCycle } from "@/lib/integrations/meta/sync";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Chamado pelo Vercel Cron (Authorization: Bearer CRON_SECRET).
 *  ?mode=hourly  estrutura + ontem/hoje (de hora em hora)
 *  ?mode=daily   reprocessa os últimos 7 dias (o Meta ajusta números retroativamente)
 * Em ambos: reenvia eventos da CAPI que falharam e recalcula os alertas (com notificação).
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!env.cronSecret || !safeEqual(auth, `Bearer ${env.cronSecret}`)) {
    return Response.json({ ok: false, error: "não autorizado" }, { status: 401 });
  }
  if (!isServiceRoleConfigured()) return Response.json({ ok: false, error: "Supabase não configurado" }, { status: 500 });
  const mode = new URL(req.url).searchParams.get("mode") === "daily" ? "daily" : "hourly";
  try {
    const capi = await retryFailedCapi(supabaseAdmin());
    const db = supabaseAdmin();
    const r = await runSyncCycle(db, mode, { timeBudgetMs: 40_000 });
    // Alertas depois do sync (dados frescos). Falha num workspace não derruba os outros.
    const { data: wss } = await db.from("ad_accounts").select("workspace_id").eq("is_active", true);
    const alerts: Record<string, unknown> = {};
    for (const ws of new Set((wss ?? []).map((w) => w.workspace_id as string))) {
      try {
        const a = await runAlertsForWorkspace(db, ws);
        alerts[ws] = { abertos: a.opened.length, resolvidos: a.resolved, notificados: a.notified };
      } catch (e) {
        alerts[ws] = { erro: (e as Error).message };
      }
    }
    return Response.json({ ok: r.errors.length === 0, mode, capi, alerts, ...r, logs: r.logs.filter((l) => !l.ok) });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
