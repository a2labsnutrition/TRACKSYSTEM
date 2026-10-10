import type { Repository } from "@/lib/data/repository";
import { demoReports } from "@/lib/advisor/memory";
import { DEFAULT_NOTIFY, type AdvisorReport, type AlertRecord, type BreakdownRow, type CapiLog, type EntityEvent, type Order, type TrackingEvent, type TrackingHealth, type UserNote, type WorkspaceContext } from "@/lib/data/types";
import { demoBreakdowns, demoEntityEvents } from "./breakdowns";
import { getMemoryStore } from "@/lib/ingest/memory-store";
import { addDays, dateIn, todayIn } from "@/lib/tz";
import { DEMO_PRODUCTS, demoCampaignId, generateDemo, type DemoData } from "./generator";

const TZ = "America/Cuiaba";

let cache: { day: string; data: DemoData; breakdowns: BreakdownRow[]; events: EntityEvent[] } | null = null;
function load() {
  const day = todayIn(TZ);
  if (!cache || cache.day !== day) {
    const d = generateDemo(day);
    const campaignRows = d.insights.filter((r) => r.level === "campaign" && r.date >= addDays(day, -29));
    cache = { day, data: d, breakdowns: demoBreakdowns(campaignRows), events: demoEntityEvents(day, d.campaigns.map((c) => c.id)) };
  }
  return cache;
}
function data(): DemoData {
  return load().data;
}

/** Repositório do modo demo — tudo fictício, mais eventos reais recebidos localmente. */
export class DemoRepository implements Repository {
  constructor(private userEmail: string | null = null) {}

  async context(): Promise<WorkspaceContext> {
    return {
      mode: "demo",
      userEmail: this.userEmail,
      workspace: {
        id: "demo",
        name: "Workspace de demonstração",
        timezone: TZ,
        currency: "BRL",
        taxRate: 0.06,
        defaultFeeRate: 0.0699,
        notify: DEFAULT_NOTIFY,
      },
      adAccounts: [
        {
          id: "demo-account",
          metaAccountId: "act_demo",
          name: "Conta Demo (fictícia)",
          currency: "BRL",
          timezone: "America/Sao_Paulo",
          status: "Ativa",
          lastSyncedAt: new Date(Date.now() - 18 * 60000).toISOString(),
        },
      ],
    };
  }

  async campaigns() {
    return data().campaigns;
  }
  async adsets(campaignId?: string) {
    return data().adsets.filter((a) => !campaignId || a.campaignId === campaignId);
  }
  async ads(campaignId?: string) {
    return data().ads.filter((a) => !campaignId || a.campaignId === campaignId);
  }
  async insights(q: { level: "account" | "campaign" | "adset" | "ad"; from: string; to: string; campaignId?: string }) {
    return data().insights.filter(
      (r) => r.level === q.level && r.date >= q.from && r.date <= q.to && (!q.campaignId || r.campaignId === q.campaignId),
    );
  }
  async orders(q: { from: string; to: string }) {
    // Pedidos reais recebidos neste servidor pelo webhook de teste (segredo demo) + fictícios
    const mem = [...getMemoryStore().ws("demo").orders.values()].map<Order>((o) => ({
      id: `mem_${o.externalId}`,
      externalId: o.externalId,
      productId: o.productId,
      productName: o.productName,
      status: o.status,
      paymentMethod: o.paymentMethod,
      grossAmount: o.grossAmount,
      fees: o.fees,
      netAmount: o.netAmount,
      currency: o.currency,
      coupon: o.coupon,
      isOrderBump: o.isOrderBump,
      isUpsell: o.isUpsell,
      customerEmail: o.customerEmail,
      createdAt: o.createdAt,
      paidAt: o.paidAt,
      refundedAt: o.refundedAt,
      utmSource: o.utmSource,
      utmMedium: o.utmMedium,
      utmCampaign: o.utmCampaign,
      utmContent: o.utmContent,
      utmTerm: o.utmTerm,
      campaignId: o.campaignId,
      adsetId: o.adsetId,
      adId: o.adId,
      attributionMethod: o.attributionMethod,
      attributionConfidence: o.attributionConfidence,
      capiPurchaseSentAt: o.capiPurchaseSentAt,
    }));
    return [...mem, ...data().orders].filter((o) => {
      const d = dateIn(new Date(o.createdAt), TZ);
      return d >= q.from && d <= q.to;
    });
  }
  async products() {
    return DEMO_PRODUCTS;
  }
  async sites() {
    return [
      {
        id: "demo-site",
        publicKey: "demo_site",
        name: "Página de demonstração",
        domain: "exemplo-demo.com",
        pixelId: null,
        checkoutSelectors: [],
        idParam: "sck",
        consentMode: "none" as const,
        createdAt: new Date().toISOString(),
      },
    ];
  }

  async recentEvents(limit: number): Promise<TrackingEvent[]> {
    // Eventos reais recebidos neste servidor (teste local do script) + fictícios
    const mem = getMemoryStore().ws("demo").events.map<TrackingEvent>((e, i) => ({
      id: `mem${i}`,
      siteId: e.siteId,
      eventName: e.eventName,
      eventId: e.eventId,
      sessionId: e.sessionId,
      visitorId: e.visitorId,
      url: e.url,
      utmCampaign: e.utmCampaign,
      utmContent: e.utmContent,
      fbclid: e.fbclid,
      hasFbp: Boolean(e.fbp),
      hasFbc: Boolean(e.fbc),
      createdAt: e.createdAt,
      capiStatus: e.capiStatus,
    }));
    const names = ["PageView", "ViewContent", "page_engagement", "InitiateCheckout", "PageView", "PageView", "ViewContent"];
    const fake: TrackingEvent[] = Array.from({ length: 25 }, (_, i) => ({
      id: `f${i}`,
      siteId: "demo-site",
      eventName: names[i % names.length],
      eventId: `demo_${i}`,
      sessionId: `sess_demo_${Math.floor(i / 3)}`,
      visitorId: `vis_demo_${Math.floor(i / 3)}`,
      url: "https://exemplo-demo.com/oferta",
      utmCampaign: `[EmagrecePro]_dor-espelho_amplo_vid01_0108|${demoCampaignId(0)}`,
      utmContent: `ad|${demoCampaignId(0)}1020`,
      fbclid: i % 2 ? "IwAR_demo" : null,
      hasFbp: true,
      hasFbc: i % 2 === 1,
      createdAt: new Date(Date.now() - i * 97_000).toISOString(),
      capiStatus: names[i % names.length] === "page_engagement" ? null : "sent",
    }));
    return [...mem.reverse(), ...fake].slice(0, limit);
  }

  async capiLogs(limit: number): Promise<CapiLog[]> {
    const mem = getMemoryStore().ws("demo").capiLogs.map<CapiLog>((l, i) => ({
      id: `m${i}`,
      eventName: l.eventName,
      eventId: l.eventId,
      status: l.status === "pending" ? "skipped" : l.status,
      httpStatus: l.httpStatus,
      response: l.response,
      createdAt: l.createdAt,
      source: l.source,
    }));
    const fake: CapiLog[] = Array.from({ length: 12 }, (_, i) => ({
      id: `f${i}`,
      eventName: i % 4 === 0 ? "Purchase" : i % 2 ? "PageView" : "InitiateCheckout",
      eventId: i % 4 === 0 ? `cakto_DEMO-${1200 + i}` : `demo_evt_${i}`,
      status: i === 5 ? "failed" : "sent",
      httpStatus: i === 5 ? 400 : 200,
      response: i === 5 ? '{"error":{"message":"Invalid parameter (exemplo fictício)"}}' : '{"events_received":1}',
      createdAt: new Date(Date.now() - i * 300_000).toISOString(),
      source: i % 4 === 0 ? "cakto" : "tracking",
    }));
    return [...mem.reverse(), ...fake].slice(0, limit);
  }

  async health(): Promise<TrackingHealth> {
    const today = todayIn(TZ);
    const from = addDays(today, -6);
    const ins = await this.insights({ level: "account", from, to: today });
    const orders = await this.orders({ from, to: today });
    const paid = orders.filter((o) => o.status === "paid");
    return {
      integrations: [
        { provider: "meta", status: "ok", label: "Meta (Marketing API)", detail: "Conta Demo · sincronizado há 18 min", lastEventAt: new Date(Date.now() - 18 * 60000).toISOString(), expiresAt: addDays(today, 41) },
        { provider: "tracking", status: "ok", label: "Script de tracking", detail: "Recebendo eventos de exemplo-demo.com", lastEventAt: new Date(Date.now() - 60000).toISOString() },
        { provider: "cakto", status: "ok", label: "Webhook Cakto", detail: "Último pedido há 42 min", lastEventAt: new Date(Date.now() - 42 * 60000).toISOString() },
        { provider: "anthropic", status: "warning", label: "IA (Claude)", detail: "Usada a partir da Fase 2 (Parecer do Consultor)", lastEventAt: null },
      ],
      lastTrackingEventAt: new Date(Date.now() - 60000).toISOString(),
      lastCaktoEventAt: new Date(Date.now() - 42 * 60000).toISOString(),
      lastMetaSyncAt: new Date(Date.now() - 18 * 60000).toISOString(),
      ordersPaid: paid.length,
      ordersAttributed: paid.filter((o) => o.attributionMethod !== "unattributed").length,
      metaPurchases: ins.reduce((s, r) => s + r.purchases, 0),
      caktoPurchases: paid.length,
      capiSent: 1840,
      capiFailed: 3,
      linkClicks: ins.reduce((s, r) => s + r.linkClicks, 0),
      landingPageViews: ins.reduce((s, r) => s + r.landingPageViews, 0),
    };
  }

  async breakdowns(q: { campaignId: string; from: string; to: string }): Promise<BreakdownRow[]> {
    return load().breakdowns.filter((r) => r.entityId === q.campaignId && r.date >= q.from && r.date <= q.to);
  }

  async entityEvents(q: { campaignId?: string; from: string; to: string }): Promise<EntityEvent[]> {
    return load().events.filter((e) => {
      const d = dateIn(new Date(e.eventTime), TZ);
      return (!q.campaignId || e.campaignId === q.campaignId) && d >= q.from && d <= q.to;
    });
  }

  async advisorReports(campaignId: string, limit = 10): Promise<AdvisorReport[]> {
    return demoReports()
      .filter((r) => r.campaignId === campaignId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit);
  }

  async alerts(): Promise<AlertRecord[]> {
    // No demo os alertas são calculados na hora (não há histórico persistido).
    return [];
  }

  async notes(campaignId?: string): Promise<UserNote[]> {
    const today = todayIn(TZ);
    const all: UserNote[] = [
      { id: "n1", campaignId: demoCampaignId(0), date: addDays(today, -12), text: "Aumentei orçamento de R$ 180 para R$ 250 (+38%).", createdAt: new Date().toISOString() },
      { id: "n2", campaignId: demoCampaignId(1), date: addDays(today, -6), text: "Subi 2 criativos UGC novos.", createdAt: new Date().toISOString() },
    ];
    return all.filter((n) => !campaignId || n.campaignId === campaignId);
  }
}
