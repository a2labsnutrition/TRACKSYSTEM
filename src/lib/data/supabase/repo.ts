import { parseCreative } from "@/lib/integrations/meta/creative-parse";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Repository } from "@/lib/data/repository";
import type {
  Ad,
  AdvisorReport,
  AlertRecord,
  BreakdownRow,
  EntityEvent,
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
import { applyFx, convertAmount, fxTableFromRows, type FxTable } from "@/lib/money/fx";
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
    adAccountId: r.ad_account_id,
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
    orderKind: r.order_kind ?? undefined,
    mainAmount: r.main_amount == null ? undefined : n(r.main_amount),
    bumpAmount: r.bump_amount == null ? undefined : n(r.bump_amount),
    upsellAmount: r.upsell_amount == null ? undefined : n(r.upsell_amount),
    netEstimated: Boolean(r.net_estimated),
  };
}

/** Linha de "creatives" → Creative, relendo o bruto (cobre criativo dinâmico e linhas antigas). */
function creativeFromRow(c: any) {
  const p = parseCreative(c.raw);
  const parsed = c.raw?._parsed ?? {};
  const texts: string[] = Array.isArray(parsed.bodies) && parsed.bodies.length ? parsed.bodies : p.bodies;
  const headlines: string[] = Array.isArray(parsed.titles) && parsed.titles.length ? parsed.titles : p.titles;
  return {
    id: c.id,
    title: c.title ?? p.title,
    body: c.body ?? p.body,
    callToAction: c.call_to_action ?? p.callToAction,
    thumbnailUrl: c.thumbnail_url,
    imageUrl: c.image_url ?? p.imageUrl,
    videoId: c.video_id ?? p.videoId,
    linkUrl: c.link_url ?? p.linkUrl,
    format: (c.format && c.format !== "unknown" ? c.format : p.format) ?? "unknown",
    texts,
    headlines,
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
    const conv = await this.budgetConverter();
    return rows.map((r) => ({
      id: r.id,
      adAccountId: r.ad_account_id,
      name: r.name,
      status: r.status,
      effectiveStatus: r.effective_status,
      objective: r.objective,
      dailyBudget: conv(r.daily_budget == null ? null : Number(r.daily_budget), r.ad_account_id),
      lifetimeBudget: conv(r.lifetime_budget == null ? null : Number(r.lifetime_budget), r.ad_account_id),
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
    const conv = await this.budgetConverter();
    const { data: camps } = await this.db.from("campaigns").select("id, ad_account_id").eq("workspace_id", this.ws);
    const accountOf = new Map((camps ?? []).map((c: any) => [c.id, c.ad_account_id]));
    return rows.map((r) => ({
      id: r.id,
      campaignId: r.campaign_id,
      name: r.name,
      status: r.status,
      effectiveStatus: r.effective_status,
      optimizationGoal: r.optimization_goal,
      dailyBudget: conv(r.daily_budget == null ? null : Number(r.daily_budget), accountOf.get(r.campaign_id)),
      lifetimeBudget: conv(r.lifetime_budget == null ? null : Number(r.lifetime_budget), accountOf.get(r.campaign_id)),
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
        creative: c ? creativeFromRow(c) : null,
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
    // Valores do Meta vêm na moeda da conta: converte para BRL (estimado quando há câmbio)
    return applyFx(rows.map(insightFromRow), this.accountMap(), await this.fx(addDays(q.from, -10), q.to));
  }

  private accountMap() {
    return new Map(this.ctx.adAccounts.map((a) => [a.id, a]));
  }

  private fxCache: FxTable = new Map();
  private fxLoaded = new Set<string>();

  /** Cotações das moedas das contas (não-BRL) no intervalo; em cache por instância. */
  private async fx(from: string, to: string): Promise<FxTable> {
    const currencies = [...new Set(this.ctx.adAccounts.map((a) => a.currency.toUpperCase()).filter((c) => c !== "BRL"))];
    if (!currencies.length) return this.fxCache;
    const key = `${from}|${to}`;
    if (this.fxLoaded.has(key)) return this.fxCache;
    const { data } = await this.db.from("fx_rates").select("date, base, rate").in("base", currencies).eq("quote", "BRL").gte("date", from).lte("date", to);
    for (const [cur, byDate] of fxTableFromRows((data ?? []) as Array<{ date: string; base: string; rate: number }>)) {
      if (!this.fxCache.has(cur)) this.fxCache.set(cur, new Map());
      for (const [d, r] of byDate) this.fxCache.get(cur)!.set(d, r);
    }
    this.fxLoaded.add(key);
    return this.fxCache;
  }

  /** Orçamentos também vêm na moeda da conta: converte com a cotação de hoje. */
  private async budgetConverter(): Promise<(v: number | null, accountId: string | null | undefined) => number | null> {
    const today = todayIn(this.ctx.workspace.timezone);
    const table = await this.fx(addDays(today, -10), today);
    const accounts = this.accountMap();
    return (v, accountId) => convertAmount(v, accountId ? accounts.get(accountId) : undefined, table, today);
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
    const [{ data }, { data: rules }] = await Promise.all([
      this.db.from("products").select("*").eq("workspace_id", this.ws).order("name"),
      this.db.from("decision_rules").select("product_id, config").eq("workspace_id", this.ws).not("product_id", "is", null),
    ]);
    const rulesBy = new Map((rules ?? []).map((r: any) => [r.product_id, r.config]));
    return (data ?? []).map((r: any) => ({
      rules: rulesBy.get(r.id) ?? undefined,
      kind: r.kind ?? "principal",
      costPerSale: n(r.cost_per_sale),
      costPct: n(r.cost_pct),
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

  async breakdowns(q: { campaignId: string; from: string; to: string }): Promise<BreakdownRow[]> {
    const rows = await fetchAll<any>((a, b) =>
      this.db
        .from("insights_breakdowns_daily")
        .select("breakdown, breakdown_value, entity_id, date, spend, impressions, reach, link_clicks, landing_page_views, initiate_checkout, purchases, purchase_value")
        .eq("workspace_id", this.ws)
        .eq("level", "campaign")
        .eq("entity_id", q.campaignId)
        .gte("date", q.from)
        .lte("date", q.to)
        .range(a, b),
    );
    return rows.map((r) => ({
      breakdown: r.breakdown,
      value: r.breakdown_value,
      entityId: r.entity_id,
      date: String(r.date).slice(0, 10),
      spend: n(r.spend),
      impressions: n(r.impressions),
      reach: n(r.reach),
      linkClicks: n(r.link_clicks),
      landingPageViews: n(r.landing_page_views),
      initiateCheckout: n(r.initiate_checkout),
      purchases: n(r.purchases),
      purchaseValue: n(r.purchase_value),
    }));
  }

  async entityEvents(q: { campaignId?: string; from: string; to: string }): Promise<EntityEvent[]> {
    const tz = this.ctx.workspace.timezone;
    let qq = this.db
      .from("entity_events")
      .select("id, campaign_id, adset_id, ad_id, event_type, label, source, event_time")
      .eq("workspace_id", this.ws)
      .gte("event_time", localDayStartUtc(q.from, tz))
      .lt("event_time", localDayStartUtc(addDays(q.to, 1), tz))
      .order("event_time", { ascending: false })
      .limit(300);
    if (q.campaignId) qq = qq.eq("campaign_id", q.campaignId);
    const { data } = await qq;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      campaignId: r.campaign_id,
      adsetId: r.adset_id,
      adId: r.ad_id,
      eventType: r.event_type,
      label: r.label,
      source: r.source,
      eventTime: r.event_time,
    }));
  }

  async advisorReports(campaignId: string, limit = 10): Promise<AdvisorReport[]> {
    const { data } = await this.db
      .from("advisor_reports")
      .select("id, campaign_id, report_date, created_at, status, rules_status, confidence, model, content")
      .eq("workspace_id", this.ws)
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return (data ?? []).map((r: any) => ({
      id: r.id,
      campaignId: r.campaign_id,
      reportDate: String(r.report_date),
      createdAt: r.created_at,
      status: r.status,
      rulesStatus: r.rules_status,
      confidence: r.confidence,
      model: r.model ?? "",
      content: r.content,
    }));
  }

  async alerts(q: { status?: "open" | "all"; limit?: number }): Promise<AlertRecord[]> {
    let qq = this.db
      .from("alerts")
      .select("id, type, severity, entity_level, entity_id, message, data, status, created_at, resolved_at, notified_at")
      .eq("workspace_id", this.ws)
      .order("created_at", { ascending: false })
      .limit(q.limit ?? 200);
    if (q.status === "open") qq = qq.eq("status", "open");
    const { data } = await qq;
    return (data ?? []).map((r: any) => ({
      id: r.id,
      type: r.type,
      severity: r.severity,
      entityLevel: r.entity_level,
      entityId: r.entity_id,
      title: r.data?.title ?? String(r.message).split(" — ")[0],
      message: r.data?.title && String(r.message).startsWith(r.data.title) ? String(r.message).slice(r.data.title.length + 3) : r.message,
      href: r.data?.href ?? null,
      status: r.status,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      notifiedAt: r.notified_at,
    }));
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
