import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readCredential } from "@/lib/credentials";
import { caktoListOrders, caktoToken, orderToWebhookBody } from "@/lib/integrations/cakto/api";
import { addDays, todayIn } from "@/lib/tz";
import { ingestTrustedCaktoEvent } from "./cakto-webhook";
import type { IngestStore } from "./store";

export interface ReconcileResult {
  read: number;
  created: number;
  duplicates: number;
  /** Pedidos que ficaram para a próxima vez por limite de tempo. */
  rest: number;
}

/**
 * Conciliação com a API da Cakto: busca os pedidos dos últimos `days` dias e
 * passa cada um pelo mesmo processamento do webhook (idempotente: o que já
 * existe com o mesmo status não duplica; status novo — ex.: Pix pago — atualiza).
 * Recupera vendas e order bumps que o webhook não entregou.
 */
export async function reconcileCaktoWorkspace(
  db: SupabaseClient,
  store: IngestStore,
  workspaceId: string,
  timezone: string,
  opts: { days?: number; deadlineMs?: number } = {},
): Promise<ReconcileResult | null> {
  const cred = await readCredential(db, workspaceId, "cakto_api");
  if (!cred) return null;
  const c = JSON.parse(cred.secret) as { clientId: string; clientSecret: string };
  const token = await caktoToken(c);
  const today = todayIn(timezone);
  const orders = await caktoListOrders(token, { createdFrom: addDays(today, -(opts.days ?? 7)), createdTo: today, maxPages: 50 });
  const deadline = Date.now() + (opts.deadlineMs ?? 200_000);
  let created = 0;
  let duplicates = 0;
  let processed = 0;
  for (let i = 0; i < orders.length && Date.now() < deadline; i += 5) {
    const rs = await Promise.all(
      orders
        .slice(i, i + 5)
        .map((o) => ingestTrustedCaktoEvent(store, workspaceId, orderToWebhookBody(o as Record<string, unknown>), { "x-source": "cakto-api" }).catch(() => null)),
    );
    for (const r of rs) {
      processed++;
      if (r?.body.duplicate) duplicates++;
      else if (r?.status === 200) created++;
    }
  }
  return { read: orders.length, created, duplicates, rest: orders.length - processed };
}
