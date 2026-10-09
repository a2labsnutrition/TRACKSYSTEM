import { env, isServiceRoleConfigured } from "@/lib/env";
import { safeEqual } from "@/lib/crypto";
import { retryFailedCapi } from "@/lib/ingest/capi-retry";
import { runSyncCycle } from "@/lib/integrations/meta/sync";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const maxDuration = 60;

/**
 * Chamado pelo Vercel Cron (Authorization: Bearer CRON_SECRET).
 *  ?mode=hourly  estrutura + ontem/hoje (de hora em hora)
 *  ?mode=daily   reprocessa os últimos 7 dias (o Meta ajusta números retroativamente)
 * Em ambos: reenvia eventos da CAPI que falharam.
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
    const r = await runSyncCycle(supabaseAdmin(), mode, { timeBudgetMs: 45_000 });
    return Response.json({ ok: r.errors.length === 0, mode, capi, ...r, logs: r.logs.filter((l) => !l.ok) });
  } catch (e) {
    return Response.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
