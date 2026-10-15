import { env, isServiceRoleConfigured } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { runAlertsForWorkspace } from "@/lib/alerts/run";
import { getIngestStore } from "@/lib/ingest";
import { reconcileCaktoWorkspace } from "@/lib/ingest/cakto-reconcile";
import { retryFailedCapi } from "@/lib/ingest/capi-retry";
import { runSyncCycle } from "@/lib/integrations/meta/sync";
import { log } from "@/lib/log";
import { syncFxRates } from "@/lib/money/fx-sync";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 120;

/**
 * Chamado pelo Vercel Cron (Authorization: Bearer CRON_SECRET).
 *  ?mode=daily   estrutura + últimos 7 dias (o Meta ajusta números retroativamente) — o único agendado
 *                no vercel.json, porque o plano Hobby da Vercel só aceita agendamento diário
 *  ?mode=hourly  estrutura + ontem/hoje (para um agendador externo, se quiser de hora em hora)
 * Além disso, o painel sincroniza sozinho ao ser aberto quando o último sync tem mais de 1 h.
 * Em ambos: atualiza a PTAX das contas em moeda estrangeira, reenvia eventos da CAPI
 * que falharam e recalcula os alertas (com notificação).
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!env.cronSecret || !safeEqual(auth, `Bearer ${env.cronSecret}`)) {
    return Response.json({ ok: false, error: "não autorizado" }, { status: 401 });
  }
  if (!isServiceRoleConfigured()) return Response.json({ ok: false, error: "Supabase não configurado" }, { status: 500 });
  const mode = new URL(req.url).searchParams.get("mode") === "daily" ? "daily" : "hourly";
  try {
    const db = supabaseAdmin();
    // Câmbio antes do sync: falha aqui não interrompe nada (vale a taxa manual ou "sem cotação")
    const fx = await syncFxRates(db).catch((e: Error) => ({ ok: false, error: e.message }));
    const capi = await retryFailedCapi(db);
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
    // Conciliação com a API da Cakto: recupera vendas, Pix pagos e order bumps que o webhook não entregou
    const cakto: Record<string, unknown> = {};
    const { data: wsRows } = await db.from("workspaces").select("id, timezone");
    for (const w of wsRows ?? []) {
      try {
        const rc = await reconcileCaktoWorkspace(db, getIngestStore(), w.id as string, (w.timezone as string) || "America/Sao_Paulo", {
          days: mode === "daily" ? 7 : 2,
          deadlineMs: 12_000,
        });
        if (rc) cakto[w.id as string] = { lidos: rc.read, novos: rc.created };
      } catch (e) {
        cakto[w.id as string] = { erro: (e as Error).message };
      }
    }
    log.info("cron.meta_sync", { mode, errors: r.errors.length, fxOk: fx.ok });
    return Response.json({ ok: r.errors.length === 0, mode, fx, capi, alerts, cakto, ...r, logs: r.logs.filter((l) => !l.ok) });
  } catch (e) {
    log.error("cron.meta_sync_failed", { mode, error: e });
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
