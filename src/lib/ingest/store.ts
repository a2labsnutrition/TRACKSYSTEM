import type { SessionRef } from "@/lib/attribution/attribute";
import type { AttributionMethod, OrderStatus, PaymentMethod, TrackingSite } from "@/lib/data/types";

/**
 * Interface de persistência usada pela ingestão (script de tracking, webhook
 * da Cakto, CAPI). Implementações: MemoryIngestStore (testes e modo demo
 * local) e SupabaseIngestStore (produção, via service role).
 */

export interface SessionRecord extends SessionRef {
  siteId: string;
  firstUrl: string | null;
  referrer: string | null;
  utmMedium: string | null;
  device: string | null;
  emailHash: string | null;
  phoneHash: string | null;
  startedAt: string;
}

export interface EventRecord {
  siteId: string;
  eventName: string;
  eventId: string;
  sessionId: string | null;
  visitorId: string | null;
  url: string | null;
  referrer: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  fbclid: string | null;
  fbp: string | null;
  fbc: string | null;
  clientIp: string | null;
  userAgent: string | null;
  props: Record<string, unknown>;
  capiStatus: "sent" | "failed" | "skipped" | "pending" | null;
  createdAt: string;
}

export interface OrderRecord {
  externalId: string;
  productId: string | null;
  productExternalId: string | null;
  productName: string | null;
  offerId: string | null;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  grossAmount: number;
  fees: number;
  netAmount: number;
  netEstimated: boolean;
  currency: string;
  coupon: string | null;
  isOrderBump: boolean;
  isUpsell: boolean;
  parentOrderId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  emailHash: string | null;
  phoneHash: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  sck: string | null;
  src: string | null;
  fbclid: string | null;
  fbp: string | null;
  fbc: string | null;
  sessionId: string | null;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  attributionMethod: AttributionMethod;
  attributionConfidence: number;
  capiPurchaseSentAt: string | null;
  createdAt: string;
  paidAt: string | null;
  refundedAt: string | null;
}

export interface CapiConfig {
  pixelId: string;
  accessToken: string;
  testEventCode: string | null;
}

export interface CapiLogEntry {
  pixelId: string | null;
  eventName: string;
  eventId: string;
  source: "tracking" | "cakto" | "test";
  status: "pending" | "sent" | "failed" | "skipped";
  httpStatus: number | null;
  matchKeys: number | null;
  request: unknown;
  response: string | null;
}

export interface WorkspaceSettings {
  timezone: string;
  defaultFeeRate: number;
  currency: string;
}

export interface RawCaktoInsert {
  workspaceId: string | null;
  dedupeKey: string;
  eventName: string;
  orderExternalId: string | null;
  payload: unknown;
  headers: Record<string, string>;
  signatureValid: boolean;
  warnings: string[];
}

export interface IngestStore {
  // ---- tracking ----
  findSiteByPublicKey(publicKey: string): Promise<{ workspaceId: string; site: TrackingSite } | null>;
  getSession(workspaceId: string, sessionId: string): Promise<SessionRecord | null>;
  upsertSession(workspaceId: string, s: SessionRecord): Promise<void>;
  /** false se (site, event_id, event_name) já existia — deduplicação. */
  insertEvent(workspaceId: string, e: EventRecord): Promise<boolean>;
  updateEventCapiStatus(workspaceId: string, siteId: string, eventId: string, eventName: string, status: EventRecord["capiStatus"]): Promise<void>;

  // ---- atribuição ----
  sessionByFbclid(workspaceId: string, fbclid: string): Promise<SessionRecord | null>;
  sessionByEmailHash(workspaceId: string, hash: string): Promise<SessionRecord | null>;
  sessionByPhoneHash(workspaceId: string, hash: string): Promise<SessionRecord | null>;
  checkoutClicksBetween(workspaceId: string, fromIso: string, toIso: string): Promise<SessionRecord[]>;

  // ---- cakto ----
  findCaktoWorkspace(opts: { workspaceKey?: string | null; secretHash?: string | null }): Promise<{ workspaceId: string; secret: string } | null>;
  /**
   * inserted=false quando a chave de idempotência já existe; nesse caso
   * alreadyProcessed diz se o evento anterior foi processado com sucesso
   * (se não foi, o reenvio da Cakto reprocessa o mesmo registro).
   */
  insertRawCakto(r: RawCaktoInsert): Promise<{ inserted: boolean; id: string | null; alreadyProcessed: boolean }>;
  markRawProcessed(id: string, error: string | null): Promise<void>;
  getOrder(workspaceId: string, externalId: string): Promise<OrderRecord | null>;
  upsertOrder(workspaceId: string, o: OrderRecord): Promise<void>;
  productIdForCakto(workspaceId: string, caktoProductId: string | null): Promise<string | null>;
  workspaceSettings(workspaceId: string): Promise<WorkspaceSettings>;

  // ---- CAPI ----
  capiConfig(workspaceId: string, pixelId?: string | null): Promise<CapiConfig | null>;
  /** Grava log; retorna false se já havia um envio "sent" para (event_name, event_id). */
  logCapi(workspaceId: string, entry: CapiLogEntry): Promise<boolean>;
  wasCapiSent(workspaceId: string, eventName: string, eventId: string): Promise<boolean>;
}
