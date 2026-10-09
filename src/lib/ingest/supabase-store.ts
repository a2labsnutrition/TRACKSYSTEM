import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret } from "@/lib/crypto";
import type { TrackingSite } from "@/lib/data/types";
import type {
  CapiLogEntry,
  EventRecord,
  IngestStore,
  OrderRecord,
  RawCaktoInsert,
  SessionRecord,
  WorkspaceSettings,
} from "./store";

/* eslint-disable @typescript-eslint/no-explicit-any */

export function siteFromRow(r: any): TrackingSite {
  return {
    id: r.id,
    publicKey: r.public_key,
    name: r.name,
    domain: r.domain,
    pixelId: r.pixel_id,
    checkoutSelectors: r.checkout_selectors ?? [],
    idParam: r.id_param ?? "sck",
    consentMode: r.consent_mode ?? "none",
    createdAt: r.created_at,
  };
}

function sessionFromRow(r: any): SessionRecord {
  return {
    sessionId: r.id,
    siteId: r.site_id,
    visitorId: r.visitor_id,
    firstUrl: r.first_url,
    referrer: r.referrer,
    utmSource: r.utm_source,
    utmMedium: r.utm_medium,
    utmCampaign: r.utm_campaign,
    utmContent: r.utm_content,
    utmTerm: r.utm_term,
    fbclid: r.fbclid,
    fbp: r.fbp,
    fbc: r.fbc,
    clientIp: r.client_ip,
    userAgent: r.user_agent,
    device: r.device,
    emailHash: r.email_hash,
    phoneHash: r.phone_hash,
    startedAt: r.started_at,
    lastSeenAt: r.last_seen_at,
  };
}

function sessionToRow(ws: string, s: SessionRecord) {
  return {
    workspace_id: ws,
    id: s.sessionId,
    site_id: s.siteId,
    visitor_id: s.visitorId,
    first_url: s.firstUrl,
    referrer: s.referrer,
    utm_source: s.utmSource,
    utm_medium: s.utmMedium,
    utm_campaign: s.utmCampaign,
    utm_content: s.utmContent,
    utm_term: s.utmTerm,
    fbclid: s.fbclid,
    fbp: s.fbp,
    fbc: s.fbc,
    client_ip: s.clientIp,
    user_agent: s.userAgent,
    device: s.device,
    email_hash: s.emailHash,
    phone_hash: s.phoneHash,
    started_at: s.startedAt,
    last_seen_at: s.lastSeenAt,
  };
}

export function orderFromRow(r: any): OrderRecord {
  return {
    externalId: r.external_id,
    productId: r.product_id,
    productExternalId: r.product_external_id,
    productName: r.product_name,
    offerId: r.offer_id,
    status: r.status,
    paymentMethod: r.payment_method,
    grossAmount: Number(r.gross_amount),
    fees: Number(r.fees),
    netAmount: Number(r.net_amount),
    netEstimated: r.net_estimated,
    currency: r.currency,
    coupon: r.coupon,
    isOrderBump: r.is_order_bump,
    isUpsell: r.is_upsell,
    parentOrderId: r.parent_order_id,
    customerName: r.customer_name,
    customerEmail: r.customer_email,
    customerPhone: r.customer_phone,
    emailHash: r.email_hash,
    phoneHash: r.phone_hash,
    utmSource: r.utm_source,
    utmMedium: r.utm_medium,
    utmCampaign: r.utm_campaign,
    utmContent: r.utm_content,
    utmTerm: r.utm_term,
    sck: r.sck,
    src: r.src,
    fbclid: r.fbclid,
    fbp: r.fbp,
    fbc: r.fbc,
    sessionId: r.session_id,
    campaignId: r.campaign_id,
    adsetId: r.adset_id,
    adId: r.ad_id,
    attributionMethod: r.attribution_method,
    attributionConfidence: Number(r.attribution_confidence),
    capiPurchaseSentAt: r.capi_purchase_sent_at,
    createdAt: r.created_at,
    paidAt: r.paid_at,
    refundedAt: r.refunded_at,
  };
}

function orderToRow(ws: string, o: OrderRecord) {
  return {
    workspace_id: ws,
    external_id: o.externalId,
    product_id: o.productId,
    product_external_id: o.productExternalId,
    product_name: o.productName,
    offer_id: o.offerId,
    status: o.status,
    payment_method: o.paymentMethod,
    gross_amount: o.grossAmount,
    fees: o.fees,
    net_amount: o.netAmount,
    net_estimated: o.netEstimated,
    currency: o.currency,
    coupon: o.coupon,
    is_order_bump: o.isOrderBump,
    is_upsell: o.isUpsell,
    parent_order_id: o.parentOrderId,
    customer_name: o.customerName,
    customer_email: o.customerEmail,
    customer_phone: o.customerPhone,
    email_hash: o.emailHash,
    phone_hash: o.phoneHash,
    utm_source: o.utmSource,
    utm_medium: o.utmMedium,
    utm_campaign: o.utmCampaign,
    utm_content: o.utmContent,
    utm_term: o.utmTerm,
    sck: o.sck,
    src: o.src,
    fbclid: o.fbclid,
    fbp: o.fbp,
    fbc: o.fbc,
    session_id: o.sessionId,
    campaign_id: o.campaignId,
    adset_id: o.adsetId,
    ad_id: o.adId,
    attribution_method: o.attributionMethod,
    attribution_confidence: o.attributionConfidence,
    capi_purchase_sent_at: o.capiPurchaseSentAt,
    created_at: o.createdAt,
    paid_at: o.paidAt,
    refunded_at: o.refundedAt,
    updated_at: new Date().toISOString(),
  };
}

function check<T>(res: { data: T; error: { message: string; code?: string } | null }, ctx: string): T {
  if (res.error) throw new Error(`${ctx}: ${res.error.message}`);
  return res.data;
}

export class SupabaseIngestStore implements IngestStore {
  constructor(private db: SupabaseClient) {}

  async findSiteByPublicKey(publicKey: string) {
    const { data } = await this.db.from("tracking_sites").select("*").eq("public_key", publicKey).maybeSingle();
    return data ? { workspaceId: data.workspace_id as string, site: siteFromRow(data) } : null;
  }

  async getSession(ws: string, id: string) {
    const { data } = await this.db.from("tracking_sessions").select("*").eq("workspace_id", ws).eq("id", id).maybeSingle();
    return data ? sessionFromRow(data) : null;
  }

  async upsertSession(ws: string, s: SessionRecord) {
    check(await this.db.from("tracking_sessions").upsert(sessionToRow(ws, s)), "upsert sessão");
  }

  async insertEvent(ws: string, e: EventRecord) {
    const res = await this.db.from("tracking_events").insert({
      workspace_id: ws,
      site_id: e.siteId,
      event_name: e.eventName,
      event_id: e.eventId,
      session_id: e.sessionId,
      visitor_id: e.visitorId,
      url: e.url,
      referrer: e.referrer,
      utm_source: e.utmSource,
      utm_medium: e.utmMedium,
      utm_campaign: e.utmCampaign,
      utm_content: e.utmContent,
      utm_term: e.utmTerm,
      fbclid: e.fbclid,
      fbp: e.fbp,
      fbc: e.fbc,
      client_ip: e.clientIp,
      user_agent: e.userAgent,
      props: e.props,
      capi_status: e.capiStatus,
      created_at: e.createdAt,
    });
    if (res.error?.code === "23505") return false; // duplicado
    check(res, "inserir evento");
    return true;
  }

  async updateEventCapiStatus(ws: string, siteId: string, eventId: string, eventName: string, status: EventRecord["capiStatus"]) {
    await this.db
      .from("tracking_events")
      .update({ capi_status: status })
      .eq("workspace_id", ws)
      .eq("site_id", siteId)
      .eq("event_id", eventId)
      .eq("event_name", eventName);
  }

  private async oneSession(ws: string, col: string, value: string) {
    const { data } = await this.db
      .from("tracking_sessions")
      .select("*")
      .eq("workspace_id", ws)
      .eq(col, value)
      .order("last_seen_at", { ascending: false })
      .limit(1);
    return data?.[0] ? sessionFromRow(data[0]) : null;
  }
  sessionByFbclid(ws: string, v: string) {
    return this.oneSession(ws, "fbclid", v);
  }
  sessionByEmailHash(ws: string, v: string) {
    return this.oneSession(ws, "email_hash", v);
  }
  sessionByPhoneHash(ws: string, v: string) {
    return this.oneSession(ws, "phone_hash", v);
  }

  async checkoutClicksBetween(ws: string, fromIso: string, toIso: string) {
    const { data } = await this.db
      .from("tracking_events")
      .select("session_id, created_at")
      .eq("workspace_id", ws)
      .eq("event_name", "InitiateCheckout")
      .gte("created_at", fromIso)
      .lte("created_at", toIso)
      .order("created_at", { ascending: false })
      .limit(20);
    const ids = [...new Set((data ?? []).map((r) => r.session_id).filter(Boolean))] as string[];
    if (!ids.length) return [];
    const { data: sessions } = await this.db.from("tracking_sessions").select("*").eq("workspace_id", ws).in("id", ids);
    const byId = new Map((sessions ?? []).map((s) => [s.id, sessionFromRow(s)]));
    return ids.map((id) => byId.get(id)).filter(Boolean) as SessionRecord[];
  }

  async findCaktoWorkspace(opts: { workspaceKey?: string | null; secretHash?: string | null }) {
    let q = this.db.from("integration_credentials").select("workspace_id, encrypted_secret").eq("provider", "cakto");
    if (opts.workspaceKey) q = q.eq("workspace_id", opts.workspaceKey);
    else if (opts.secretHash) q = q.eq("lookup_hash", opts.secretHash);
    else return null;
    const { data } = await q.limit(1);
    const row = data?.[0];
    if (!row) return null;
    try {
      return { workspaceId: row.workspace_id as string, secret: decryptSecret(row.encrypted_secret) };
    } catch {
      return null;
    }
  }

  async insertRawCakto(r: RawCaktoInsert) {
    const res = await this.db
      .from("cakto_events_raw")
      .insert({
        workspace_id: r.workspaceId,
        dedupe_key: r.dedupeKey,
        event_name: r.eventName,
        order_external_id: r.orderExternalId,
        payload: r.payload,
        headers: r.headers,
        signature_valid: r.signatureValid,
        warnings: r.warnings,
      })
      .select("id")
      .single();
    if (res.error?.code === "23505") {
      const { data } = await this.db
        .from("cakto_events_raw")
        .select("id, processed")
        .eq("workspace_id", r.workspaceId)
        .eq("dedupe_key", r.dedupeKey)
        .maybeSingle();
      return { inserted: false, id: data ? String(data.id) : null, alreadyProcessed: Boolean(data?.processed) };
    }
    const row = check(res, "gravar webhook bruto");
    return { inserted: true, id: String(row?.id), alreadyProcessed: false };
  }

  async markRawProcessed(id: string, error: string | null) {
    await this.db.from("cakto_events_raw").update({ processed: !error, process_error: error }).eq("id", Number(id));
  }

  async getOrder(ws: string, externalId: string) {
    const { data } = await this.db.from("orders").select("*").eq("workspace_id", ws).eq("external_id", externalId).maybeSingle();
    return data ? orderFromRow(data) : null;
  }

  async upsertOrder(ws: string, o: OrderRecord) {
    check(await this.db.from("orders").upsert(orderToRow(ws, o), { onConflict: "workspace_id,external_id" }), "salvar pedido");
  }

  async productIdForCakto(ws: string, caktoProductId: string | null) {
    if (!caktoProductId) return null;
    const { data } = await this.db
      .from("products")
      .select("id")
      .eq("workspace_id", ws)
      .contains("cakto_product_ids", [caktoProductId])
      .limit(1);
    return (data?.[0]?.id as string) ?? null;
  }

  async workspaceSettings(ws: string): Promise<WorkspaceSettings> {
    const { data } = await this.db.from("workspaces").select("timezone, default_fee_rate, currency").eq("id", ws).single();
    return {
      timezone: data?.timezone ?? "America/Cuiaba",
      defaultFeeRate: Number(data?.default_fee_rate ?? 0.0699),
      currency: data?.currency ?? "BRL",
    };
  }

  async capiConfig(ws: string, pixelId?: string | null) {
    let q = this.db.from("pixels").select("pixel_id, test_event_code, capi_credential_id").eq("workspace_id", ws);
    if (pixelId) q = q.eq("pixel_id", pixelId);
    const { data: pixels } = await q.limit(1);
    const px = pixels?.[0];
    if (!px) return null;
    // Token da CAPI: credencial específica do pixel, senão o token Meta principal.
    let credQ = this.db.from("integration_credentials").select("encrypted_secret, provider").eq("workspace_id", ws);
    credQ = px.capi_credential_id ? credQ.eq("id", px.capi_credential_id) : credQ.in("provider", ["meta_capi", "meta"]);
    const { data: creds } = await credQ.order("provider", { ascending: false }).limit(1);
    const cred = creds?.[0];
    if (!cred) return null;
    try {
      return { pixelId: px.pixel_id as string, accessToken: decryptSecret(cred.encrypted_secret), testEventCode: px.test_event_code ?? null };
    } catch {
      return null;
    }
  }

  async logCapi(ws: string, e: CapiLogEntry) {
    if (await this.wasCapiSent(ws, e.eventName, e.eventId)) return false;
    check(
      await this.db.from("capi_logs").upsert(
        {
          workspace_id: ws,
          pixel_id: e.pixelId,
          event_name: e.eventName,
          event_id: e.eventId,
          source: e.source,
          status: e.status,
          http_status: e.httpStatus,
          match_keys: e.matchKeys,
          request: e.request,
          response: e.response,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "workspace_id,event_name,event_id" },
      ),
      "log CAPI",
    );
    return true;
  }

  async wasCapiSent(ws: string, eventName: string, eventId: string) {
    const { data } = await this.db
      .from("capi_logs")
      .select("status")
      .eq("workspace_id", ws)
      .eq("event_name", eventName)
      .eq("event_id", eventId)
      .maybeSingle();
    return data?.status === "sent";
  }
}
