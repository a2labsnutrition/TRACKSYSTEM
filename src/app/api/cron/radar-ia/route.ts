import { runAlertsForWorkspace } from "@/lib/alerts/run";
import { safeEqual } from "@/lib/crypto";
import { env, isServiceRoleConfigured } from "@/lib/env";
import { log } from "@/lib/log";
import { hasYoutube, measureAndSave, radarSubniches } from "@/lib/radar";
import type { SubnicheMeasure } from "@/lib/radar/measure";
import { SupabaseRadarStore } from "@/lib/radar/supabase-store";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 120;

/**
 * Radar de Nichos de IA — medição diária (Vercel Cron, Authorization: Bearer CRON_SECRET).
 * Mede a demanda no YouTube de cada subnicho, grava o histórico do dia em cada
 * workspace e recalcula os alertas (o "subnicho em alta" vira alerta e notificação).
 * O catálogo é medido UMA vez e reaproveitado entre workspaces (economiza cota).
 */
export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  if (!env.cronSecret || !safeEqual(auth, `Bearer ${env.cronSecret}`)) {
    return Response.json({ ok: false, error: "não autorizado" }, { status: 401 });
  }
  if (!isServiceRoleConfigured()) return Response.json({ ok: false, error: "Supabase não configurado" }, { status: 500 });
  if (!hasYoutube()) return Response.json({ ok: false, error: "YOUTUBE_API_KEY não configurada" });
  const db = supabaseAdmin();
  const shared = new Map<string, SubnicheMeasure>();
  const result: Record<string, unknown> = {};
  try {
    const { data: wss } = await db.from("workspaces").select("id, timezone");
    for (const w of wss ?? []) {
      const ws = w.id as string;
      try {
        const store = new SupabaseRadarStore(db, ws);
        const { snapshot, run } = await measureAndSave(store, await radarSubniches(store), (w.timezone as string) || env.defaultTimezone, { shared });
        const alerts = await runAlertsForWorkspace(db, ws).catch((e: Error) => ({ erro: e.message }));
        result[ws] = { gravado: Boolean(snapshot), erros: run.errors, cota: run.quotaExhausted, alertas: "opened" in alerts ? alerts.opened.filter((a) => a.type === "radar_em_alta").length : alerts };
      } catch (e) {
        result[ws] = { erro: (e as Error).message };
      }
    }
    log.info("cron.radar_ia", { workspaces: Object.keys(result).length, measured: shared.size });
    return Response.json({ ok: true, medidos: shared.size, workspaces: result });
  } catch (e) {
    log.error("cron.radar_ia_failed", { error: e });
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
