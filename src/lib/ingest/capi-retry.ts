import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendCapiEvents, type CapiEvent } from "@/lib/integrations/meta/capi";
import { SupabaseIngestStore } from "./supabase-store";

/**
 * Reenvia eventos da CAPI que falharam (até 5 tentativas, com espera crescente).
 * O event_id é o mesmo do envio original, então o Meta deduplica se algum já tiver chegado.
 */
export async function retryFailedCapi(db: SupabaseClient, limit = 50): Promise<{ retried: number; sent: number }> {
  const { data } = await db
    .from("capi_logs")
    .select("id, workspace_id, pixel_id, event_name, event_id, request, attempts")
    .eq("status", "failed")
    .lt("attempts", 5)
    .lte("next_retry_at", new Date().toISOString())
    .order("updated_at")
    .limit(limit);
  const store = new SupabaseIngestStore(db);
  let sent = 0;
  for (const row of data ?? []) {
    const cfg = await store.capiConfig(row.workspace_id, row.pixel_id);
    if (!cfg || !row.request) continue;
    const ev = row.request as CapiEvent;
    // O Meta recusa event_time com mais de 7 dias: nesse caso desiste.
    const tooOld = Date.now() / 1000 - ev.event_time > 7 * 86400;
    const r = tooOld ? null : await sendCapiEvents(cfg.pixelId, cfg.accessToken, [ev], { testEventCode: cfg.testEventCode });
    const attempts = (row.attempts ?? 0) + 1;
    await db
      .from("capi_logs")
      .update({
        status: r?.ok ? "sent" : "failed",
        http_status: r?.httpStatus ?? null,
        response: r?.response ?? "Evento com mais de 7 dias — o Meta não aceita reenvio",
        attempts: tooOld ? 5 : attempts,
        next_retry_at: new Date(Date.now() + 2 ** attempts * 10 * 60_000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (r?.ok) sent++;
  }
  return { retried: data?.length ?? 0, sent };
}
