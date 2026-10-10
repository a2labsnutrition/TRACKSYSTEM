import { hashEmail, hashName, hashPhone, sha256, splitName } from "@/lib/crypto";
import { env } from "@/lib/env";

/**
 * API de Conversões (CAPI) do Meta.
 * POST https://graph.facebook.com/{versão}/{pixel_id}/events
 * Deduplicação com o Pixel: mesmo event_name + event_id nos dois lados.
 */

/** "OrderBump" é um evento personalizado (não padrão): não conta como compra no Meta. */
export type CapiEventName = "PageView" | "ViewContent" | "InitiateCheckout" | "AddPaymentInfo" | "Purchase" | "Lead" | "OrderBump";

export const BROWSER_EVENTS_TO_CAPI = new Set<CapiEventName>(["PageView", "ViewContent", "InitiateCheckout", "AddPaymentInfo", "Lead"]);

export interface CapiInput {
  eventName: CapiEventName;
  eventId: string;
  eventTime: Date;
  eventSourceUrl?: string | null;
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  externalId?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  value?: number | null;
  currency?: string | null;
  orderId?: string | null;
  contentIds?: string[];
  contentName?: string | null;
}

export interface CapiEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: "website";
  event_source_url?: string;
  user_data: Record<string, unknown>;
  custom_data?: Record<string, unknown>;
}

export function buildCapiEvent(i: CapiInput): CapiEvent {
  const user: Record<string, unknown> = {};
  const em = hashEmail(i.email);
  const ph = hashPhone(i.phone);
  const { first, last } = splitName(i.fullName);
  const fn = hashName(first);
  const ln = hashName(last);
  if (em) user.em = [em];
  if (ph) user.ph = [ph];
  if (fn) user.fn = [fn];
  if (ln) user.ln = [ln];
  if (i.externalId) user.external_id = [sha256(i.externalId)];
  if (i.clientIp) user.client_ip_address = i.clientIp;
  if (i.userAgent) user.client_user_agent = i.userAgent;
  if (i.fbp) user.fbp = i.fbp;
  if (i.fbc) user.fbc = i.fbc;

  const custom: Record<string, unknown> = {};
  if (i.value != null) custom.value = Math.round(i.value * 100) / 100;
  if (i.value != null || i.currency) custom.currency = (i.currency ?? "BRL").toUpperCase();
  if (i.orderId) custom.order_id = i.orderId;
  if (i.contentIds?.length) {
    custom.content_ids = i.contentIds;
    custom.content_type = "product";
  }
  if (i.contentName) custom.content_name = i.contentName;

  const ev: CapiEvent = {
    event_name: i.eventName,
    event_time: Math.floor(i.eventTime.getTime() / 1000),
    event_id: i.eventId,
    action_source: "website",
    user_data: user,
  };
  if (i.eventSourceUrl) ev.event_source_url = i.eventSourceUrl;
  if (Object.keys(custom).length) ev.custom_data = custom;
  return ev;
}

/** Quantos parâmetros de correspondência o evento tem (proxy local da qualidade). */
export function matchKeyCount(ev: CapiEvent): number {
  return ["em", "ph", "fn", "ln", "external_id", "client_ip_address", "client_user_agent", "fbp", "fbc"].filter(
    (k) => ev.user_data[k] != null,
  ).length;
}

export interface CapiSendResult {
  ok: boolean;
  httpStatus: number;
  response: string;
  eventsReceived: number | null;
  fbtraceId: string | null;
}

export async function sendCapiEvents(
  pixelId: string,
  accessToken: string,
  events: CapiEvent[],
  opts: { testEventCode?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<CapiSendResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `https://graph.facebook.com/${env.metaGraphVersion}/${encodeURIComponent(pixelId)}/events?access_token=${encodeURIComponent(accessToken)}`;
  const body: Record<string, unknown> = { data: events };
  if (opts.testEventCode) body.test_event_code = opts.testEventCode;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    let parsed: { events_received?: number; fbtrace_id?: string } = {};
    try {
      parsed = JSON.parse(text);
    } catch {
      /* corpo não-JSON */
    }
    return {
      ok: res.ok,
      httpStatus: res.status,
      response: text.slice(0, 2000),
      eventsReceived: parsed.events_received ?? null,
      fbtraceId: parsed.fbtrace_id ?? null,
    };
  } catch (e) {
    return { ok: false, httpStatus: 0, response: `Falha de rede: ${(e as Error).message}`, eventsReceived: null, fbtraceId: null };
  }
}

/** Monta _fbc a partir de um fbclid (formato documentado: fb.1.<ms>.<fbclid>). */
export function fbcFromFbclid(fbclid: string, at: Date = new Date()): string {
  return `fb.1.${at.getTime()}.${fbclid}`;
}
