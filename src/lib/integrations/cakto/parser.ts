import type { OrderStatus, PaymentMethod } from "@/lib/data/types";
import { sha256 } from "@/lib/crypto";
import { toNumber } from "@/lib/utils";

/**
 * Parser TOLERANTE dos webhooks da Cakto.
 *
 * Formato documentado (docs.cakto.com.br / mirror Mintlify, consultado em 10/2026):
 *   { "secret": "...", "event": "purchase_approved", "data": { ... } }
 * Eventos documentados: purchase_approved, purchase_refused, pix_gerado,
 * boleto_gerado, refund, chargeback, checkout_abandonment, subscription_*.
 *
 * Como nomes de campos podem mudar, cada valor é procurado em vários caminhos.
 * O payload bruto SEMPRE é gravado (cakto_events_raw) para reprocessar depois.
 * Para ajustar a um campo novo, altere só este arquivo.
 */

export type CaktoKind =
  | "order_paid"
  | "order_pending"
  | "order_refused"
  | "order_refunded"
  | "order_chargeback"
  | "checkout_abandoned"
  | "subscription_canceled"
  | "checkout_started"
  | "test"
  | "unknown";

const EVENT_MAP: Record<string, { kind: CaktoKind; status: OrderStatus }> = {
  purchase_approved: { kind: "order_paid", status: "paid" },
  purchase_approval: { kind: "order_paid", status: "paid" },
  compra_aprovada: { kind: "order_paid", status: "paid" },
  subscription_created: { kind: "order_paid", status: "paid" },
  subscription_renewed: { kind: "order_paid", status: "paid" },
  purchase_refused: { kind: "order_refused", status: "refused" },
  compra_recusada: { kind: "order_refused", status: "refused" },
  subscription_renewal_refused: { kind: "order_refused", status: "refused" },
  pix_gerado: { kind: "order_pending", status: "pending" },
  pix_generated: { kind: "order_pending", status: "pending" },
  boleto_gerado: { kind: "order_pending", status: "pending" },
  boleto_generated: { kind: "order_pending", status: "pending" },
  picpay_gerado: { kind: "order_pending", status: "pending" },
  openfinance_nubank_gerado: { kind: "order_pending", status: "pending" },
  refund: { kind: "order_refunded", status: "refunded" },
  reembolso: { kind: "order_refunded", status: "refunded" },
  chargeback: { kind: "order_chargeback", status: "chargeback" },
  checkout_abandonment: { kind: "checkout_abandoned", status: "abandoned" },
  abandono_checkout: { kind: "checkout_abandoned", status: "abandoned" },
  subscription_canceled: { kind: "subscription_canceled", status: "canceled" },
  initiate_checkout: { kind: "checkout_started", status: "unknown" },
  test: { kind: "test", status: "unknown" },
  teste: { kind: "test", status: "unknown" },
};

const STATUS_MAP: Record<string, OrderStatus> = {
  paid: "paid",
  approved: "paid",
  aprovado: "paid",
  pago: "paid",
  authorized: "paid",
  waiting_payment: "pending",
  pending: "pending",
  aguardando_pagamento: "pending",
  processing: "pending",
  refused: "refused",
  recusado: "refused",
  declined: "refused",
  refunded: "refunded",
  reembolsado: "refunded",
  chargedback: "chargeback",
  chargeback: "chargeback",
  canceled: "canceled",
  cancelled: "canceled",
};

export interface CaktoTracking {
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
}

export interface ParsedCaktoEvent {
  eventName: string;
  kind: CaktoKind;
  secret: string | null;
  orderExternalId: string | null;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  grossAmount: number;
  fees: number | null;
  netAmount: number | null;
  currency: string;
  coupon: string | null;
  isOrderBump: boolean;
  isUpsell: boolean;
  parentOrderId: string | null;
  productExternalId: string | null;
  productName: string | null;
  offerId: string | null;
  customerName: string | null;
  customerEmail: string | null;
  customerPhone: string | null;
  customerDocument: string | null;
  createdAt: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  checkoutUrl: string | null;
  clientIp: string | null;
  clientUserAgent: string | null;
  tracking: CaktoTracking;
  /** Chave de idempotência: o mesmo evento repetido gera a mesma chave. */
  dedupeKey: string;
  warnings: string[];
}

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Busca o primeiro valor não-vazio entre vários caminhos ("a.b.c"). */
export function pick(obj: unknown, paths: string[]): unknown {
  for (const p of paths) {
    let cur: unknown = obj;
    for (const k of p.split(".")) {
      if (!isObj(cur)) {
        cur = undefined;
        break;
      }
      cur = cur[k];
    }
    if (cur !== undefined && cur !== null && cur !== "") return cur;
  }
  return undefined;
}

function str(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

function num(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "string") {
    // aceita "1.234,56" e "1234.56"
    const s = v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  const n = toNumber(v);
  return Number.isFinite(n) ? n : null;
}

function isoDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const d = new Date(/^\d+$/.test(s) ? Number(s) * (s.length <= 10 ? 1000 : 1) : s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function normalizePaymentMethod(v: unknown): PaymentMethod {
  const s = (str(v) ?? "").toLowerCase();
  if (!s) return "other";
  if (s.includes("pix")) return "pix";
  if (s.includes("boleto") || s.includes("bank_slip") || s.includes("ticket")) return "boleto";
  if (s.includes("card") || s.includes("cartao") || s.includes("cartão") || s.includes("credit")) return "credit_card";
  return "other";
}

function queryParams(url: string | null): URLSearchParams | null {
  if (!url) return null;
  try {
    return new URL(url).searchParams;
  } catch {
    return null;
  }
}

function extractTracking(data: Json, checkoutUrl: string | null): CaktoTracking {
  const qp = queryParams(checkoutUrl);
  const roots = ["", "tracking.", "utm.", "utms.", "metadata.", "checkout.", "order."];
  const f = (keys: string[]): string | null => {
    const paths = roots.flatMap((r) => keys.map((k) => `${r}${k}`));
    const fromData = str(pick(data, paths));
    if (fromData) return fromData;
    if (qp) for (const k of keys) if (qp.get(k)) return qp.get(k);
    return null;
  };
  return {
    utmSource: f(["utm_source", "utmSource"]),
    utmMedium: f(["utm_medium", "utmMedium"]),
    utmCampaign: f(["utm_campaign", "utmCampaign"]),
    utmContent: f(["utm_content", "utmContent"]),
    utmTerm: f(["utm_term", "utmTerm"]),
    sck: f(["sck"]),
    src: f(["src"]),
    fbclid: f(["fbclid"]),
    fbp: f(["fbp", "_fbp"]),
    fbc: f(["fbc", "_fbc"]),
  };
}

export function parseCaktoWebhook(body: unknown): ParsedCaktoEvent {
  const warnings: string[] = [];
  const root: Json = isObj(body) ? body : {};
  const data: Json = isObj(root.data) ? (root.data as Json) : root;

  const eventName = (str(pick(root, ["event", "event_name", "type", "custom_id"])) ?? "unknown").toLowerCase();
  const mapped = EVENT_MAP[eventName];
  if (!mapped) warnings.push(`Evento desconhecido: "${eventName}" (gravado, não processado como venda)`);

  const rawStatus = (str(pick(data, ["status", "order.status", "payment.status"])) ?? "").toLowerCase();
  let status: OrderStatus = mapped?.status ?? STATUS_MAP[rawStatus] ?? "unknown";
  // Se o evento é genérico, o status do pedido decide.
  if ((!mapped || mapped.status === "unknown") && STATUS_MAP[rawStatus]) status = STATUS_MAP[rawStatus];

  const kind: CaktoKind = mapped?.kind ?? "unknown";

  const orderExternalId = str(pick(data, ["id", "order_id", "orderId", "order.id", "refId", "ref_id", "transaction_id"]));
  const checkoutUrl = str(pick(data, ["checkoutUrl", "checkout_url", "checkout.url", "url"]));

  const grossAmount = num(pick(data, ["amount", "baseAmount", "base_amount", "total", "value", "price", "order.amount", "offer.price"])) ?? 0;
  const fees = num(pick(data, ["fees", "fee", "gateway_fee", "taxes", "platform_fee"]));
  let netAmount = num(pick(data, ["netAmount", "net_amount", "liquid_amount", "producer_amount", "commission", "producerCommission"]));
  if (netAmount == null && Array.isArray(data.commissions)) {
    const producer = (data.commissions as Json[]).find((c) => /producer|produtor/i.test(String(c.type ?? c.role ?? "")));
    netAmount = num(producer?.totalAmount ?? producer?.amount ?? producer?.value);
  }
  if (netAmount == null && fees != null) netAmount = Math.max(0, grossAmount - fees);
  if (netAmount == null) warnings.push("Valor líquido não informado: será estimado com a taxa padrão do workspace");

  const productExternalId = str(pick(data, ["product.id", "product_id", "productId", "offer.product", "items.0.product.id"]));
  const productName = str(pick(data, ["product.name", "product_name", "productName", "offer.name", "items.0.name"]));
  const offerId = str(pick(data, ["offer.id", "offer_id", "offerId"]));
  const type = (str(pick(data, ["type", "offer_type", "offer.type", "product.type"])) ?? "").toLowerCase();
  const isOrderBump = /bump/.test(type) || Boolean(pick(data, ["isOrderBump", "is_order_bump", "orderbump"]));
  const isUpsell = /upsell|upsale/.test(type) || Boolean(pick(data, ["isUpsell", "is_upsell"]));
  const parentOrderId = str(pick(data, ["parent_order", "parentOrder", "parent_order_id", "mainOrderId"]));

  const customerEmail = str(pick(data, ["customer.email", "customerEmail", "customer_email", "email", "buyer.email"]));
  const customerName = str(pick(data, ["customer.name", "customerName", "customer_name", "name", "buyer.name"]));
  const customerPhone = str(pick(data, ["customer.phone", "customerPhone", "customer_phone", "phone", "buyer.phone"]));
  const customerDocument = str(pick(data, ["customer.docNumber", "customer.document", "customer.cpf", "document"]));

  const tracking = extractTracking(data, checkoutUrl);

  const createdAt = isoDate(pick(data, ["createdAt", "created_at", "date", "order.createdAt"]));
  const paidAt = isoDate(pick(data, ["paidAt", "paid_at", "approvedDate", "approved_at"])) ?? (status === "paid" ? createdAt : null);
  const refundedAt = isoDate(pick(data, ["refundedAt", "refunded_at", "chargedbackAt"]));

  const paymentMethod = normalizePaymentMethod(
    pick(data, ["paymentMethod", "payment_method", "payment.method", "paymentType"]) ??
      (eventName.startsWith("pix") ? "pix" : eventName.startsWith("boleto") ? "boleto" : undefined),
  );

  // Idempotência: evento + pedido + status. Sem ID de pedido (ex.: abandono),
  // usa e-mail + URL + data.
  const keyBase = orderExternalId
    ? `${eventName}|${orderExternalId}|${status}`
    : `${eventName}|${customerEmail ?? ""}|${checkoutUrl ?? ""}|${createdAt ?? ""}|${grossAmount}`;
  const explicitId = str(pick(root, ["id", "event_id", "webhook_id"]));
  const dedupeKey = sha256(explicitId && explicitId !== orderExternalId ? `evt|${explicitId}` : keyBase);

  if (!orderExternalId && kind !== "checkout_abandoned" && kind !== "test")
    warnings.push("Pedido sem ID — verifique o formato do payload");

  return {
    eventName,
    kind,
    secret: str(pick(root, ["secret", "data.secret", "token"])),
    orderExternalId,
    status,
    paymentMethod,
    grossAmount,
    fees,
    netAmount,
    currency: (str(pick(data, ["currency", "order.currency"])) ?? "BRL").toUpperCase(),
    coupon: str(pick(data, ["couponCode", "coupon", "coupon_code", "discount_code"])),
    isOrderBump,
    isUpsell,
    parentOrderId,
    productExternalId,
    productName,
    offerId,
    customerName,
    customerEmail,
    customerPhone,
    customerDocument,
    createdAt,
    paidAt,
    refundedAt,
    checkoutUrl,
    clientIp: str(pick(data, ["ip", "client_ip", "customer.ip"])),
    clientUserAgent: str(pick(data, ["user_agent", "userAgent", "customer.userAgent"])),
    tracking,
    dedupeKey,
    warnings,
  };
}
