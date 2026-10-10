import type { ParecerContent } from "@/lib/advisor/schema";
import type { DecisionConfig, DecisionStatus } from "@/lib/decision/rules";

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
  notify: NotifySettings;
}

export interface NotifySettings {
  emails: string[];
  telegramChatId: string | null;
  minSeverity: "critico" | "atencao";
}

export const DEFAULT_NOTIFY: NotifySettings = { emails: [], telegramChatId: null, minSeverity: "atencao" };

export interface AdAccount {
  id: string; // uuid interno
  metaAccountId: string; // act_123
  name: string;
  currency: string;
  timezone: string;
  status: string;
  lastSyncedAt: string | null;
  /** Conversão de moeda quando a conta não está em BRL. */
  fxMode?: "auto" | "manual";
  fxManualRate?: number | null;
  /** IOF + spread do cartão sobre a cobrança internacional (0.035 = 3,5%). */
  fxSpreadPct?: number;
}

export type ProductKind = "principal" | "order_bump" | "upsell";

export interface Product {
  id: string;
  name: string;
  price: number;
  netPerSale: number | null;
  targetCpa: number | null;
  maxCpa: number | null;
  minRoas: number | null;
  caktoProductIds: string[];
  /** Ajustes das regras de decisão para este produto (kill, frequência, volume mínimo...). */
  rules?: Partial<DecisionConfig>;
  /** Papel do produto no funil (pedidos de order bump/upsell não contam como compra principal). */
  kind?: ProductKind;
  /** Custo variável fixo por venda (R$) — ex.: entrega, ferramenta por aluno. */
  costPerSale?: number;
  /** Custo variável proporcional ao faturamento (0.1 = 10%) — ex.: coprodução, afiliados. */
  costPct?: number;
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
  /** Variações de texto principal e de título (criativo dinâmico/Advantage+). */
  texts?: string[];
  headlines?: string[];
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
  /** Conta de anúncios (uuid interno) — usada para converter moeda. */
  adAccountId?: string;
  /** Moeda original da conta e valor antes da conversão (quando houve conversão). */
  currency?: string;
  spendOriginal?: number;
  /** Taxa usada (moeda da conta -> BRL, já com IOF/spread) e se é estimativa. */
  fxRate?: number | null;
  fxEstimated?: boolean;
  /** Sem cotação para converter: valor ficou na moeda original (não somar com BRL!). */
  fxMissing?: boolean;
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
  /** Composição (opcional em dados antigos; ver orderParts()). */
  orderKind?: OrderKind;
  mainAmount?: number;
  bumpAmount?: number;
  upsellAmount?: number;
  /** Valor líquido estimado com a taxa padrão (a Cakto não informou). */
  netEstimated?: boolean;
}

export type OrderKind = "main" | "bump" | "upsell";

/** Composição do pedido com padrões para dados antigos. */
export function orderParts(o: Pick<Order, "grossAmount" | "isOrderBump" | "isUpsell" | "orderKind" | "mainAmount" | "bumpAmount" | "upsellAmount">) {
  const kind: OrderKind = o.orderKind ?? (o.isOrderBump ? "bump" : o.isUpsell ? "upsell" : "main");
  const hasSplit = (o.mainAmount ?? 0) + (o.bumpAmount ?? 0) + (o.upsellAmount ?? 0) > 0;
  if (hasSplit) return { kind, main: o.mainAmount ?? 0, bump: o.bumpAmount ?? 0, upsell: o.upsellAmount ?? 0 };
  return {
    kind,
    main: kind === "main" ? o.grossAmount : 0,
    bump: kind === "bump" ? o.grossAmount : 0,
    upsell: kind === "upsell" ? o.grossAmount : 0,
  };
}

export type AttributionLevel = "confirmada" | "provavel" | "desconhecida";

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

// ----------------------------- Fase 2 -----------------------------

export type BreakdownKey = "age" | "gender" | "age_gender" | "placement" | "device" | "region" | "hour";

export interface BreakdownRow {
  breakdown: BreakdownKey;
  value: string;
  entityId: string;
  date: string;
  spend: number;
  impressions: number;
  reach: number;
  linkClicks: number;
  landingPageViews: number;
  initiateCheckout: number;
  purchases: number;
  purchaseValue: number;
}

export interface EntityEvent {
  id: string;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  eventType: string;
  label: string;
  source: "meta_activity" | "sync_detected";
  eventTime: string;
}

export interface AdvisorReport {
  id: string;
  campaignId: string;
  reportDate: string;
  createdAt: string;
  /** Veredito do consultor (IA ou fallback). */
  status: DecisionStatus;
  /** Veredito do motor de regras no momento do parecer. */
  rulesStatus: DecisionStatus | null;
  confidence: string | null;
  model: string;
  content: ParecerContent;
}

export type AlertSeverity = "critico" | "atencao" | "info";

export interface AlertRecord {
  id: string;
  type: string;
  severity: AlertSeverity;
  entityLevel: string | null;
  entityId: string | null;
  title: string;
  message: string;
  href: string | null;
  status: "open" | "resolved";
  createdAt: string;
  resolvedAt: string | null;
  notifiedAt: string | null;
}
