import { buildCapiEvent, matchKeyCount, sendCapiEvents, type CapiInput, type CapiSendResult } from "@/lib/integrations/meta/capi";
import type { IngestStore } from "./store";

export type CapiSender = typeof sendCapiEvents;

/**
 * Envia um evento para a CAPI com idempotência: se (event_name, event_id) já
 * foi enviado com sucesso, não envia de novo. Sempre grava o log.
 */
export async function dispatchCapi(
  store: IngestStore,
  workspaceId: string,
  input: CapiInput,
  source: "tracking" | "cakto" | "test",
  opts: { pixelId?: string | null; sender?: CapiSender } = {},
): Promise<{ status: "sent" | "failed" | "skipped"; result?: CapiSendResult; reason?: string }> {
  const config = await store.capiConfig(workspaceId, opts.pixelId);
  const event = buildCapiEvent(input);
  if (!config) {
    await store.logCapi(workspaceId, {
      pixelId: opts.pixelId ?? null,
      eventName: input.eventName,
      eventId: input.eventId,
      source,
      status: "skipped",
      httpStatus: null,
      matchKeys: matchKeyCount(event),
      request: event,
      response: "CAPI não configurada (Pixel + token em Conexões → Meta)",
    });
    return { status: "skipped", reason: "capi_not_configured" };
  }
  if (await store.wasCapiSent(workspaceId, input.eventName, input.eventId)) {
    return { status: "skipped", reason: "already_sent" };
  }
  const sender = opts.sender ?? sendCapiEvents;
  const result = await sender(config.pixelId, config.accessToken, [event], { testEventCode: config.testEventCode });
  const status = result.ok ? "sent" : "failed";
  await store.logCapi(workspaceId, {
    pixelId: config.pixelId,
    eventName: input.eventName,
    eventId: input.eventId,
    source,
    status,
    httpStatus: result.httpStatus,
    matchKeys: matchKeyCount(event),
    request: event,
    response: result.response,
  });
  return { status, result };
}
