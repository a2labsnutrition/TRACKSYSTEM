import type { Repository } from "@/lib/data/repository";
import {
  DEFAULT_NOTIFY,
  type Ad,
  type AdAccount,
  type AdSet,
  type AdvisorReport,
  type AlertRecord,
  type BreakdownRow,
  type Campaign,
  type CapiLog,
  type EntityEvent,
  type InsightDaily,
  type Order,
  type Product,
  type TrackingEvent,
  type TrackingHealth,
  type TrackingSite,
  type UserNote,
  type WorkspaceContext,
} from "@/lib/data/types";
import { applyFx, convertAmount, type FxTable } from "@/lib/money/fx";
import { dateIn, todayIn } from "@/lib/tz";

/**
 * Cenário "caso real" (dados de exemplo baseados no caso descrito na auditoria):
 *  - conta de anúncios em US$, orçamento de US$ 20/dia, câmbio manual R$ 5,00 (≈ R$ 100 gastos);
 *  - 1 campanha no 1º dia, 5 criativos; um deles recebeu US$ 13 (65% do gasto);
 *  - 3 vendas do produto principal de R$ 97 + 2 order bumps de R$ 19,90
 *    (um dentro do pedido, outro como pedido separado — os dois formatos da Cakto);
 *  - rastreamento incompleto: nenhuma venda chegou com sck/UTM → sem origem.
 * Resultado esperado: bruto R$ 330,80; faturamento − tráfego R$ 230,80; ROAS 3,308;
 * CPA R$ 33,33; nenhuma venda atribuída ao criativo de maior gasto; sem escala.
 */

const TZ = "America/Cuiaba";
const OFFSET = "-04:00";
export const CASO_REAL_FX = 5;

const ACCOUNT: AdAccount = {
  id: "caso-account",
  metaAccountId: "act_caso_real",
  name: "Conta em dólar (exemplo)",
  currency: "USD",
  timezone: TZ,
  status: "Ativa",
  lastSyncedAt: null,
  fxMode: "manual",
  fxManualRate: CASO_REAL_FX,
  fxSpreadPct: 0,
};

const CAMPAIGN_ID = "120200000000000001";
const ADSET_ID = "120200000000000011";

const PRODUCTS: Product[] = [
  { id: "cr-main", name: "Produto principal (R$ 97)", price: 97, netPerSale: null, targetCpa: null, maxCpa: null, minRoas: null, caktoProductIds: ["caso_main"], kind: "principal" },
  { id: "cr-bump", name: "Order bump (R$ 19,90)", price: 19.9, netPerSale: null, targetCpa: null, maxCpa: null, minRoas: null, caktoProductIds: ["caso_bump"], kind: "order_bump" },
];

/** Gasto e métricas por criativo, em US$ (moeda da conta), no 1º dia. */
const CREATIVES: Array<{ name: string; format: Creative; usd: number; impressions: number; clicks: number; lpv: number; ic: number; metaPurchases: number; video3s: number }> = [
  { name: "CR01 — vídeo dor", format: "video", usd: 13, impressions: 2600, clicks: 38, lpv: 29, ic: 4, metaPurchases: 1, video3s: 780 },
  { name: "CR02 — vídeo depoimento", format: "video", usd: 2.5, impressions: 520, clicks: 9, lpv: 7, ic: 1, metaPurchases: 0, video3s: 170 },
  { name: "CR03 — imagem oferta", format: "image", usd: 2, impressions: 430, clicks: 6, lpv: 5, ic: 1, metaPurchases: 1, video3s: 0 },
  { name: "CR04 — vídeo bastidores", format: "video", usd: 1.5, impressions: 310, clicks: 4, lpv: 3, ic: 0, metaPurchases: 0, video3s: 90 },
  { name: "CR05 — carrossel", format: "carousel", usd: 1, impressions: 220, clicks: 2, lpv: 1, ic: 0, metaPurchases: 0, video3s: 0 },
];
type Creative = "video" | "image" | "carousel";

function at(day: string, hm: string) {
  return new Date(`${day}T${hm}:00${OFFSET}`).toISOString();
}

export function casoRealData(day = todayIn(TZ)) {
  const created = at(day, "07:30");
  const campaigns: Campaign[] = [
    {
      id: CAMPAIGN_ID,
      adAccountId: ACCOUNT.id,
      name: "[Produto97]_teste_5criativos_amplo",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      objective: "OUTCOME_SALES",
      dailyBudget: 20, // US$ (convertido abaixo)
      lifetimeBudget: null,
      budgetType: "CBO",
      bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      createdTime: created,
      productId: "cr-main",
    },
  ];
  const adsets: AdSet[] = [
    {
      id: ADSET_ID,
      campaignId: CAMPAIGN_ID,
      name: "Amplo 25-54",
      status: "ACTIVE",
      effectiveStatus: "ACTIVE",
      optimizationGoal: "OFFSITE_CONVERSIONS",
      dailyBudget: null,
      lifetimeBudget: null,
      bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      learningStage: "LEARNING",
      createdTime: created,
      targetingSummary: "Amplo · 25–54 · Brasil",
    },
  ];
  const ads: Ad[] = CREATIVES.map((c, i) => ({
    id: `${ADSET_ID}${i + 1}`,
    adsetId: ADSET_ID,
    campaignId: CAMPAIGN_ID,
    name: c.name,
    status: "ACTIVE",
    effectiveStatus: "ACTIVE",
    createdTime: created,
    creative: {
      id: `crv${i + 1}`,
      title: "Produto principal",
      body: `${c.name}\n\nTexto do anúncio de exemplo.`,
      callToAction: "LEARN_MORE",
      thumbnailUrl: null,
      imageUrl: null,
      videoId: c.format === "video" ? `v${i}` : null,
      linkUrl: "https://exemplo-caso.com/oferta",
      format: c.format,
    },
  }));

  const adRows: InsightDaily[] = CREATIVES.map((c, i) => ({
    level: "ad",
    entityId: ads[i].id,
    adAccountId: ACCOUNT.id,
    campaignId: CAMPAIGN_ID,
    adsetId: ADSET_ID,
    date: day,
    spend: c.usd,
    impressions: c.impressions,
    reach: Math.round(c.impressions / 1.08),
    clicks: Math.round(c.clicks * 1.4),
    linkClicks: c.clicks,
    landingPageViews: c.lpv,
    initiateCheckout: c.ic,
    addPaymentInfo: Math.max(0, c.ic - 1),
    purchases: c.metaPurchases,
    purchaseValue: Math.round(c.metaPurchases * (97 / CASO_REAL_FX) * 100) / 100, // valor do Pixel convertido p/ a moeda da conta
    video3s: c.video3s,
    thruplay: Math.round(c.video3s * 0.22),
    videoP25: Math.round(c.video3s * 0.55),
    videoP50: Math.round(c.video3s * 0.33),
    videoP75: Math.round(c.video3s * 0.2),
    videoP95: Math.round(c.video3s * 0.1),
    videoP100: Math.round(c.video3s * 0.08),
    videoAvgTimeSec: c.video3s ? 7.5 : null,
    qualityRanking: null,
    engagementRanking: null,
    conversionRanking: null,
  }));
  const sumRow = (level: InsightDaily["level"], entityId: string, campaignId: string | null, adsetId: string | null): InsightDaily => {
    const r: InsightDaily = { ...adRows[0], level, entityId, campaignId, adsetId };
    for (const k of ["spend", "impressions", "reach", "clicks", "linkClicks", "landingPageViews", "initiateCheckout", "addPaymentInfo", "purchases", "purchaseValue", "video3s", "thruplay", "videoP25", "videoP50", "videoP75", "videoP95", "videoP100"] as const) {
      (r[k] as number) = Math.round(adRows.reduce((s, x) => s + (x[k] as number), 0) * 100) / 100;
    }
    return r;
  };
  const insightsUsd: InsightDaily[] = [
    ...adRows,
    sumRow("adset", ADSET_ID, CAMPAIGN_ID, ADSET_ID),
    sumRow("campaign", CAMPAIGN_ID, CAMPAIGN_ID, null),
    sumRow("account", ACCOUNT.metaAccountId, null, null),
  ];

  const base = {
    currency: "BRL",
    coupon: null,
    refundedAt: null,
    utmMedium: null,
    utmCampaign: null,
    utmContent: null,
    utmTerm: null,
    campaignId: null,
    adsetId: null,
    adId: null,
    attributionMethod: "unattributed" as const,
    attributionConfidence: 0,
    capiPurchaseSentAt: null,
    isUpsell: false,
  };
  const est = (gross: number) => Math.round(gross * (1 - 0.0699) * 100) / 100;
  const orders: Order[] = [
    // 1) principal + bump no MESMO pedido; a Cakto não informou o líquido (estimado)
    { ...base, id: "cr1", externalId: "CASO-1", productId: "cr-main", productName: "Produto principal", status: "paid", paymentMethod: "pix", grossAmount: 116.9, fees: 0, netAmount: est(116.9), netEstimated: true, isOrderBump: false, orderKind: "main", mainAmount: 97, bumpAmount: 19.9, upsellAmount: 0, customerEmail: "cliente1@exemplo.com", createdAt: at(day, "10:05"), paidAt: at(day, "10:12"), utmSource: null },
    // 2) só o principal, cartão, com líquido informado
    { ...base, id: "cr2", externalId: "CASO-2", productId: "cr-main", productName: "Produto principal", status: "paid", paymentMethod: "credit_card", grossAmount: 97, fees: 8.74, netAmount: 88.26, isOrderBump: false, orderKind: "main", mainAmount: 97, bumpAmount: 0, upsellAmount: 0, customerEmail: "cliente2@exemplo.com", createdAt: at(day, "13:38"), paidAt: at(day, "13:40"), utmSource: "facebook" },
    // 3) principal + 4) bump como pedido SEPARADO (outro formato da Cakto)
    { ...base, id: "cr3", externalId: "CASO-3", productId: "cr-main", productName: "Produto principal", status: "paid", paymentMethod: "pix", grossAmount: 97, fees: 0, netAmount: est(97), netEstimated: true, isOrderBump: false, orderKind: "main", mainAmount: 97, bumpAmount: 0, upsellAmount: 0, customerEmail: "cliente3@exemplo.com", createdAt: at(day, "16:01"), paidAt: at(day, "16:05"), utmSource: null },
    { ...base, id: "cr4", externalId: "CASO-4", productId: "cr-bump", productName: "Order bump", status: "paid", paymentMethod: "pix", grossAmount: 19.9, fees: 0, netAmount: est(19.9), netEstimated: true, isOrderBump: true, orderKind: "bump", mainAmount: 0, bumpAmount: 19.9, upsellAmount: 0, customerEmail: "cliente3@exemplo.com", createdAt: at(day, "16:01"), paidAt: at(day, "16:05"), utmSource: null },
    // Pix gerado e não pago (não entra no faturamento)
    { ...base, id: "cr5", externalId: "CASO-5", productId: "cr-main", productName: "Produto principal", status: "pending", paymentMethod: "pix", grossAmount: 97, fees: 0, netAmount: est(97), netEstimated: true, isOrderBump: false, orderKind: "main", mainAmount: 97, bumpAmount: 0, upsellAmount: 0, customerEmail: "cliente4@exemplo.com", createdAt: at(day, "18:20"), paidAt: null, utmSource: null },
  ];
  return { day, campaigns, adsets, ads, insightsUsd, orders };
}

/** Repositório do cenário (somente leitura, sem dados persistidos). */
export class CasoRealRepository implements Repository {
  private d = casoRealData();
  constructor(private userEmail: string | null = null, private now: () => Date = () => new Date()) {}

  async context(): Promise<WorkspaceContext> {
    return {
      mode: "demo",
      userEmail: this.userEmail,
      workspace: { id: "caso-real", name: "Cenário: caso real (dia 1, conta em US$)", timezone: TZ, currency: "BRL", taxRate: 0, defaultFeeRate: 0.0699, notify: DEFAULT_NOTIFY },
      adAccounts: [{ ...ACCOUNT, lastSyncedAt: new Date(this.now().getTime() - 20 * 60000).toISOString() }],
    };
  }
  private fx: FxTable = new Map();
  private accounts = new Map([[ACCOUNT.id, ACCOUNT]]);
  async campaigns() {
    return this.d.campaigns.map((c) => ({ ...c, dailyBudget: convertAmount(c.dailyBudget, ACCOUNT, this.fx, this.d.day) }));
  }
  async adsets(campaignId?: string) {
    return this.d.adsets.filter((a) => !campaignId || a.campaignId === campaignId);
  }
  async ads(campaignId?: string) {
    return this.d.ads.filter((a) => !campaignId || a.campaignId === campaignId);
  }
  async insights(q: { level: InsightDaily["level"]; from: string; to: string; campaignId?: string }) {
    const rows = this.d.insightsUsd.filter((r) => r.level === q.level && r.date >= q.from && r.date <= q.to && (!q.campaignId || r.campaignId === q.campaignId));
    return applyFx(rows, this.accounts, this.fx);
  }
  async orders(q: { from: string; to: string }) {
    return this.d.orders.filter((o) => {
      const d = dateIn(new Date(o.createdAt), TZ);
      return d >= q.from && d <= q.to;
    });
  }
  async products() {
    return PRODUCTS;
  }
  async sites(): Promise<TrackingSite[]> {
    return [];
  }
  async recentEvents(): Promise<TrackingEvent[]> {
    return [];
  }
  async capiLogs(): Promise<CapiLog[]> {
    return [];
  }
  async health(): Promise<TrackingHealth> {
    const now = this.now();
    const ago = (min: number) => new Date(now.getTime() - min * 60000).toISOString();
    const paid = this.d.orders.filter((o) => o.status === "paid" && o.orderKind === "main");
    return {
      integrations: [
        { provider: "meta", status: "ok", label: "Meta (Marketing API)", detail: "Conta em US$ · câmbio manual R$ 5,00", lastEventAt: ago(20) },
        { provider: "tracking", status: "warning", label: "Script de tracking", detail: "Instalado, mas o identificador da sessão (sck) não chega ao checkout: vendas sem origem", lastEventAt: ago(5) },
        { provider: "cakto", status: "ok", label: "Webhook Cakto", detail: "Recebendo pedidos", lastEventAt: ago(60) },
        { provider: "anthropic", status: "warning", label: "IA (Claude)", detail: "Sem chave: parecer automático", lastEventAt: null },
      ],
      lastTrackingEventAt: ago(5),
      lastCaktoEventAt: ago(60),
      lastMetaSyncAt: ago(20),
      ordersPaid: paid.length,
      ordersAttributed: 0,
      metaPurchases: CREATIVES.reduce((s, c) => s + c.metaPurchases, 0),
      caktoPurchases: paid.length,
      capiSent: 0,
      capiFailed: 0,
      linkClicks: CREATIVES.reduce((s, c) => s + c.clicks, 0),
      landingPageViews: CREATIVES.reduce((s, c) => s + c.lpv, 0),
    };
  }
  async notes(): Promise<UserNote[]> {
    return [];
  }
  async breakdowns(): Promise<BreakdownRow[]> {
    return [];
  }
  async entityEvents(): Promise<EntityEvent[]> {
    return [];
  }
  async advisorReports(): Promise<AdvisorReport[]> {
    return [];
  }
  async alerts(): Promise<AlertRecord[]> {
    return [];
  }
}
