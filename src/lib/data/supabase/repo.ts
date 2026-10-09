import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Repository } from "@/lib/data/repository";
import type {
  Ad,
  AdSet,
  Campaign,
  CapiLog,
  InsightDaily,
  IntegrationStatus,
  Level,
  Order,
  Product,
  TrackingEvent,
  TrackingHealth,
  TrackingSite,
  UserNote,
  WorkspaceContext,
} from "@/lib/data/types";
import { siteFromRow } from "@/lib/ingest/supabase-store";
import { addDays, localDayStartUtc, todayIn } from "@/lib/tz";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** O PostgREST limita linhas por requisição (padrão 1000): pagina com range(). */
async function fetchAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>, page = 1000, max = 50000): Promise<T[]> {
  const out: T[] = [];
  for (let start = 0; start < max; start += page) {
    const { data, error } = await build(start, start + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < page) break;
  }
  return out;
}

const n = (v: any) => (v == null ? 0 : Number(v));

function insightFromRow(r: any): InsightDaily {
  return {
    level: r.level,
    entityId: r.entity_id,
    campaignId: r.campaign_id,
    adsetId: r.adset_id,
    date: String(r.date).slice(0, 10),
    spend: n(r.spend),
    impressions: n(r.impressions),
    reach: n(r.reach),
    clicks: n(r.clicks),
    linkClicks: n(r.link_clicks),
    landingPageViews: n(r.landing_page_views),
    initiateCheckout: n(r.initiate_checkout),
    addPaymentInfo: n(r.add_payment_info),
    purchases: n(r.purchases),
    purchaseValue: n(r.purchase_value),
    video3s: n(r.video_3s),
    thruplay: n(r.thruplay),
    videoP25: n(r.video_p25),
    videoP50: n(r.video_p50),
    videoP75: n(r.video_p75),
    videoP95: n(r.video_p95),
    videoP100: n(r.video_p100),
    videoAvgTimeSec: r.video_avg_time_sec == null ? null : Number(r.video_avg_time_sec),
    qualityRanking: r.quality_ranking,
    engagementRanking: r.engagement_ranking,
    conversionRanking: r.conversion_ranking,
  };
}

function orderFromDb(r: any): Order {
  return {
    id: r.id,
    externalId: r.external_id,
    productId: r.product_id,
    productName: r.product_name,
    status: r.status,
    paymentMethod: r.payment_method,
    grossAmount: n(r.gross_amount),
    fees: n(r.fees),
    netAmount: n(r.net_amount),
    currency: r.currency,
    coupon: r.coupon,
    isOrderBump: r.is_order_bump,
    isUpsell: r.is_upsell,
    customerEmail: r.customer_email,
    createdAt: r.created_at,
    paidAt: r.paid_at,
    refundedAt: r.refunded_at,
    utmSource: r.utm_source,
    utmMedium: r.utm_medium,
    utmCampaign: r.utm_campaign,
    utmContent: r.utm_content,
    utmTerm: r.utm_term,
    campaignId: r.campaign_id,
    adsetId: r.adset_id,
    adId: r.ad_id,
    attributionMethod: r.attribution_method,
    attributionConfidence: n(r.attribution_confidence),
    capiPurchaseSentAt: r.capi_purchase_sent_at,
  };
}

export class SupabaseRepository implements Repository {
  constructor(
    private db: SupabaseClient,
    private ctx: WorkspaceContext,
  ) {}

  private get ws() {
    return this.ctx.workspace.id;
  }

  async context() {
    return this.ctx;
  }

  async campaigns(): Promise<Campaign[]> {
    const rows = await fetchAll<any>((a, b) =>
      this.db.from("campaigns").select("*").eq("workspace_id", this.ws).order("name").range(a, b),
    );
    return rows.map((r) => ({
      id: r.id,
      adAccountId: r.ad_account_id,
      name: r.name,
      status: r.status,
      effectiveStatus: r.effective_status,
      objective: r.objective,
      dailyBudget: r.daily_budget == null ? null : Number(r.daily_budget),
      lifetimeBudget: r.lifetime_budget == null ? null : Number(r.lifetime_budget),
      budgetType: r.budget_type,
      bidStrategy: r.bid_strategy,
      createdTime: r.created_time,
      productId: r.product_id,
    }));
  }

  async adsets(campaignId?: string): Promise<AdSet[]> {
    const rows = await fetchAll<any>((a, b) => {
      let q = this.db.from("adsets").select("*").eq("workspace_id", this.ws);
      if (campaignId) q = q.eq("campaign_id", campaignId);
      return q.order("name").range(a, b);
    });
    return rows.map((r) => ({
      id: r.id,
      campaignId: r.campaign_id,
      name: r.name,
      status: r.status,
      effectiveStatus: r.effective_status,
      optimizationGoal: r.optimization_goal,
      dailyBudget: r.daily_budget == null ? null : Number(r.daily_budget),
      lifetimeBudget: r.lifetime_budget == null ? null : Number(r.lifetime_budget),
      bidStrategy: r.bid_strategy,
      learningStage: r.learning_stage,
      createdTime: r.created_time,
      targetingSummary: r.targeting_summary,
    }));
  }

  async ads(campaignId?: string): Promise<Ad[]> {
    const rows = await fetchAll<any>((a, b) => {
      let q = this.db.from("ads").select("*").eq("workspace_id", this.ws);
      if (campaignId) q = q.eq("campaign_id", campaignId);
      return q.order("name").range(a, b);
    });
    const creativeIds = [...new Set(rows.map((r) => r.creative_id).filter(Boolean))];
    const creatives = new Map<string, any>();
    for (let i = 0; i < creativeIds.length; i += 200) {
      const { data } = await this.db.from("creatives").select("*").eq("workspace_id", this.ws).in("id", creativeIds.slice(i, i + 200));
      for (const c of data ?? []) creatives.set(c.id, c);
    }
    return rows.map((r) => {
      const c = r.creative_id ? creatives.get(r.creative_id) : null;
      return {
        id: r.id,
        adsetId: r.adset_id,
        campaignId: r.campaign_id,
        name: r.name,
        status: r.status,
        effectiveStatus: r.effective_status,
        createdTime: r.created_time,
        creative: c
          ? {
              id: c.id,
              title: c.title,
              body: c.body,
              callToAction: c.call_to_action,
              thumbnailUrl: c.thumbnail_url,
              imageUrl: c.image_url,
              videoId: c.video_id,
              linkUrl: c.link_url,
              format: c.format ?? "unknown",
            }
          : null,
      };
    });
  }

  async insights(q: { level: Level; from: string; to: string; campaignId?: string }): Promise<InsightDaily[]> {
    const rows = await fetchAll<any>((a, b) => {
      let qq = this.db
        .from("insights_daily")
        .select("*")
        .eq("workspace_id", this.ws)
        .eq("level", q.level)
        .gte("date", q.from)
        .lte("date", q.to);
      if (q.campaignId) qq = qq.eq("campaign_id", q.campaignId);
      return qq.order("date").range(a, b);
    });
    return rows.map(insightFromRow);
  }

  async orders(q: { from: string; to: string }): Promise<Order[]> {
    const tz = this.ctx.workspace.timezone;
    const fromUtc = localDayStartUtc(q.from, tz);
    const toUtc = localDayStartUtc(addDays(q.to, 1), tz);
    const rows = await fetchAll<any>((a, b) =>
      this.db
        .from("orders")
        .select("*")
        .eq("workspace_id", this.ws)
        .gte("created_at", fromUtc)
        .lt("created_at", toUtc)
        .order("created_at", { ascending: false })
        .range(a, b),
    );
    return rows.map(orderFromDb);
  }

  async products(): Promise<Product[]> {
    const { data } = await this.db.from("products").select("*").eq("workspace_id", this.ws).order("name");
    return (data ?? []).map((r: any) => ({
      id: r.id,
      name: r.name,
      price: n(r.price),
      netPerSale: r.net_per_sale == null ? null : Number(r.net_per_sale),
      targetCpa: r.target_cpa == null ? null : Number(r.target_cpa),
      maxCpa: r.max_cpa == null ? null : Number(r.max_cpa),
      minRoas: r.min_roas == null ? null : Number(r.min_roas),
      caktoProductIds: r.cakto_product_ids ?? [],
    }));
  }

  async sites(): Promise<TrackingSite[]> {
    const { data } = await this.db.from("tracking_sites").select("*").eq("workspace_id", this.ws).order("created_at");
    return (data ?? []).map(siteFromRow);
  }

  async recentEvents(limit: number): Promise<TrackingEvent[]> {
    const { data } = await this.db
      .from("tracking_events")
      .select("id, site_id, event_name, event_id, session_id, visitor_id, url, utm_campaign, utm_content, fbclid, fbp, fbc, created_at, capi_status")
      .eq("workspace_id", this.ws)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((r: any) => ({
      id: String(r.id),
      siteId: r.site_id,
      eventName: r.event_name,
      eventId: r.event_id,
      sessionId: r.session_id,
      visitorId: r.visitor_id,
      url: r.url,
      utmCampaign: r.utm_campaign,
      utmContent: r.utm_content,
      fbclid: r.fbclid,
      hasFbp: Boolean(r.fbp),
      hasFbc: Boolean(r.fbc),
      createdAt: r.created_at,
      capiStatus: r.capi_status,
    }));
  }

  async capiLogs(limit: number): Promise<CapiLog[]> {
    const { data } = await this.db
      .from("capi_logs")
      .select("id, event_name, event_id, status, http_status, response, created_at, source")
      .eq("workspace_id", this.ws)
      .order("updated_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((r: any) => ({
      id: String(r.id),
      eventName: r.event_name,
      eventId: r.event_id,
      status: r.status,
      httpStatus: r.http_status,
      response: r.response,
      createdAt: r.created_at,
      source: r.source,
    }));
  }

  async health(): Promise<TrackingHealth> {
    const tz = this.ctx.workspace.timezone;
    const today = todayIn(tz);
    const from = addDays(today, -6);
    const sinceUtc = localDayStartUtc(from, tz);

    const [lastEvt, lastCakto, creds, ins, orders, capiSent, capiFailed, sites] = await Promise.all([
      this.db.from("tracking_events").select("created_at").eq("workspace_id", this.ws).order("created_at", { ascending: false }).limit(1),
      this.db.from("cakto_events_raw").select("received_at, signature_valid").eq("workspace_id", this.ws).order("received_at", { ascending: false }).limit(1),
      this.db.from("integration_credentials").select("provider, status, expires_at, last_error, last_checked_at").eq("workspace_id", this.ws),
      this.insights({ level: "account", from, to: today }),
      this.orders({ from, to: today }),
      this.db.from("capi_logs").select("id", { count: "exact", head: true }).eq("workspace_id", this.ws).eq("status", "sent").gte("created_at", sinceUtc),
      this.db.from("capi_logs").select("id", { count: "exact", head: true }).eq("workspace_id", this.ws).eq("status", "failed").gte("created_at", sinceUtc),
      this.sites(),
    ]);

    const lastTrackingEventAt = lastEvt.data?.[0]?.created_at ?? null;
    const lastCaktoEventAt = lastCakto.data?.[0]?.received_at ?? null;
    const lastMetaSyncAt = this.ctx.adAccounts.map((a) => a.lastSyncedAt).filter(Boolean).sort().at(-1) ?? null;
    const credBy = new Map((creds.data ?? []).map((c: any) => [c.provider, c]));
    const paid = orders.filter((o) => o.status === "paid");

    const hoursSince = (iso: string | null) => (iso ? (Date.now() - new Date(iso).getTime()) / 3600000 : Infinity);
    const integrations: IntegrationStatus[] = [];

    const meta = credBy.get("meta") as any;
    const metaExpiresInDays = meta?.expires_at ? (new Date(meta.expires_at).getTime() - Date.now()) / 86400000 : null;
    integrations.push({
      provider: "meta",
      label: "Meta (Marketing API)",
      status: !meta ? "missing" : meta.last_error ? "error" : hoursSince(lastMetaSyncAt) > 3 || (metaExpiresInDays != null && metaExpiresInDays < 7) ? "warning" : "ok",
      detail: !meta
        ? "Não conectado"
        : meta.last_error
          ? meta.last_error
          : metaExpiresInDays != null && metaExpiresInDays < 7
            ? `Token expira em ${Math.max(0, Math.floor(metaExpiresInDays))} dia(s) — reconecte`
            : `${this.ctx.adAccounts.length} conta(s) de anúncio`,
      lastEventAt: lastMetaSyncAt,
      expiresAt: meta?.expires_at ?? null,
    });
    integrations.push({
      provider: "tracking",
      label: "Script de tracking",
      status: !sites.length ? "missing" : hoursSince(lastTrackingEventAt) > 24 ? "error" : hoursSince(lastTrackingEventAt) > 3 ? "warning" : "ok",
      detail: !sites.length ? "Nenhum site criado" : lastTrackingEventAt ? `${sites.length} site(s)` : "Instalado? Nenhum evento recebido ainda",
      lastEventAt: lastTrackingEventAt,
    });
    const cakto = credBy.get("cakto");
    integrations.push({
      provider: "cakto",
      label: "Webhook Cakto",
      status: !cakto ? "missing" : !lastCaktoEventAt ? "warning" : hoursSince(lastCaktoEventAt) > 48 ? "warning" : "ok",
      detail: !cakto ? "Segredo do webhook não configurado" : lastCaktoEventAt ? "Recebendo eventos" : "Configurado, aguardando o primeiro evento",
      lastEventAt: lastCaktoEventAt,
    });
    integrations.push({
      provider: "anthropic",
      label: "IA (Claude)",
      status: process.env.ANTHROPIC_API_KEY ? "ok" : "warning",
      detail: process.env.ANTHROPIC_API_KEY ? "Chave configurada" : "Necessária a partir da Fase 2",
      lastEventAt: null,
    });

    return {
      integrations,
      lastTrackingEventAt,
      lastCaktoEventAt,
      lastMetaSyncAt,
      ordersPaid: paid.length,
      ordersAttributed: paid.filter((o) => o.attributionMethod !== "unattributed").length,
      metaPurchases: ins.reduce((s, r) => s + r.purchases, 0),
      caktoPurchases: paid.length,
      capiSent: capiSent.count ?? 0,
      capiFailed: capiFailed.count ?? 0,
      linkClicks: ins.reduce((s, r) => s + r.linkClicks, 0),
      landingPageViews: ins.reduce((s, r) => s + r.landingPageViews, 0),
    };
  }

  async notes(campaignId?: string): Promise<UserNote[]> {
    let q = this.db.from("user_notes").select("*").eq("workspace_id", this.ws).order("note_date", { ascending: false }).limit(200);
    if (campaignId) q = q.eq("campaign_id", campaignId);
    const { data } = await q;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      campaignId: r.campaign_id,
      date: String(r.note_date),
      text: r.text,
      createdAt: r.created_at,
    }));
  }
}
