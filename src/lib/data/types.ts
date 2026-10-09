/** Tipos de domínio compartilhados entre modo demo, Supabase e UI. */

export type Level = "account" | "campaign" | "adset" | "ad";

export interface Workspace {
  id: string;
  name: string;
  timezone: string;
  currency: string;
  /** Percentual de impostos sobre a receita líquida (0.06 = 6%). */
  taxRate: number;
  /** Taxa padrão do gateway quando a Cakto não informa o líquido (0.0699 = 6,99%). */
  defaultFeeRate: number;
}

export interface AdAccount {
  id: string; // uuid interno
  metaAccountId: string; // act_123
  name: string;
  currency: string;
  timezone: string;
  status: string;
  lastSyncedAt: string | null;
}

export interface Product {
  id: string;
  name: string;
  price: number;
  netPerSale: number | null;
  targetCpa: number | null;
  maxCpa: number | null;
  minRoas: number | null;
  caktoProductIds: string[];
}

export interface Campaign {
  id: string; // id do Meta
  adAccountId: string;
  name: string;
  status: string;
  effectiveStatus: string;
  objective: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  budgetType: "CBO" | "ABO" | null;
  bidStrategy: string | null;
  createdTime: string | null;
  productId: string | null;
}

export interface AdSet {
  id: string;
  campaignId: string;
  name: string;
  status: string;
  effectiveStatus: string;
  optimizationGoal: string | null;
  dailyBudget: number | null;
  lifetimeBudget: number | null;
  bidStrategy: string | null;
  learningStage: string | null;
  createdTime: string | null;
  targetingSummary: string | null;
}

export interface Creative {
  id: string;
  title: string | null;
  body: string | null;
  callToAction: string | null;
  thumbnailUrl: string | null;
  imageUrl: string | null;
  videoId: string | null;
  linkUrl: string | null;
  format: "video" | "image" | "carousel" | "unknown";
}

export interface Ad {
  id: string;
  adsetId: string;
  campaignId: string;
  name: string;
  status: string;
  effectiveStatus: string;
  createdTime: string | null;
  creative: Creative | null;
}

/** Linha diária de insights (valores aditivos; razões são calculadas depois). */
export interface InsightDaily {
  level: Level;
  entityId: string;
  campaignId: string | null;
  adsetId: string | null;
  date: string; // YYYY-MM-DD no fuso da conta
  spend: number;
  impressions: number;
  reach: number;
  clicks: number;
  linkClicks: number;
  landingPageViews: number;
  initiateCheckout: number;
  addPaymentInfo: number;
  purchases: number;
  purchaseValue: number;
  video3s: number;
  thruplay: number;
  videoP25: number;
  videoP50: number;
  videoP75: number;
  videoP95: number;
  videoP100: number;
  videoAvgTimeSec: number | null;
  qualityRanking: string | null;
  engagementRanking: string | null;
  conversionRanking: string | null;
}

export type OrderStatus =
  | "paid"
  | "pending"
  | "refused"
  | "refunded"
  | "chargeback"
  | "abandoned"
  | "canceled"
  | "unknown";

export type PaymentMethod = "pix" | "credit_card" | "boleto" | "other";

export type AttributionMethod =
  | "checkout_param"
  | "utm_ids"
  | "fbclid"
  | "email_hash"
  | "phone_hash"
  | "time_window"
  | "unattributed";

export interface Order {
  id: string;
  externalId: string;
  productId: string | null;
  productName: string | null;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  grossAmount: number;
  fees: number;
  netAmount: number;
  currency: string;
  coupon: string | null;
  isOrderBump: boolean;
  isUpsell: boolean;
  customerEmail: string | null;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  attributionMethod: AttributionMethod;
  attributionConfidence: number;
  capiPurchaseSentAt: string | null;
}

export interface TrackingEvent {
  id: string;
  siteId: string;
  eventName: string;
  eventId: string;
  sessionId: string | null;
  visitorId: string | null;
  url: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  fbclid: string | null;
  hasFbp: boolean;
  hasFbc: boolean;
  createdAt: string;
  capiStatus: "sent" | "failed" | "skipped" | "pending" | null;
}

export interface CapiLog {
  id: string;
  eventName: string;
  eventId: string;
  status: "sent" | "failed" | "skipped";
  httpStatus: number | null;
  response: string | null;
  createdAt: string;
  source: "tracking" | "cakto" | "test";
}

export interface TrackingSite {
  id: string;
  publicKey: string;
  name: string;
  domain: string | null;
  pixelId: string | null;
  checkoutSelectors: string[];
  idParam: string;
  consentMode: "none" | "required";
  createdAt: string;
}

export interface IntegrationStatus {
  provider: "meta" | "cakto" | "tracking" | "anthropic";
  status: "ok" | "warning" | "error" | "missing";
  label: string;
  detail: string;
  lastEventAt: string | null;
  expiresAt?: string | null;
}

export interface TrackingHealth {
  integrations: IntegrationStatus[];
  lastTrackingEventAt: string | null;
  lastCaktoEventAt: string | null;
  lastMetaSyncAt: string | null;
  ordersPaid: number;
  ordersAttributed: number;
  metaPurchases: number;
  caktoPurchases: number;
  capiSent: number;
  capiFailed: number;
  linkClicks: number;
  landingPageViews: number;
}

export interface UserNote {
  id: string;
  campaignId: string | null;
  date: string;
  text: string;
  createdAt: string;
}

export interface WorkspaceContext {
  mode: "demo" | "live";
  workspace: Workspace;
  adAccounts: AdAccount[];
  userEmail: string | null;
}
