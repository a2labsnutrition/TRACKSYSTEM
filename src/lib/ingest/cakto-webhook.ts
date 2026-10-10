import { attributeOrder, type AttributionLookup } from "@/lib/attribution/attribute";
import { hashEmail, hashPhone, safeEqual, sha256 } from "@/lib/crypto";
import type { OrderStatus } from "@/lib/data/types";
import { parseCaktoWebhook } from "@/lib/integrations/cakto/parser";
import { dispatchCapi, type CapiSender } from "./capi-dispatch";
import type { IngestStore, OrderRecord } from "./store";

/**
 * Processa um webhook da Cakto:
 *  1. identifica o workspace (parâmetro ?k= ou hash do segredo)
 *  2. valida o segredo (comparação em tempo constante)
 *  3. grava o payload bruto com chave de idempotência (duplicado => 200 sem efeito)
 *  4. cria/atualiza o pedido (sem "rebaixar" status: pago não volta a pendente)
 *  5. atribui a venda a campanha/conjunto/anúncio
 *  6. pagamento aprovado => Purchase na CAPI com event_id fixo `cakto_<pedido>`
 *     (nunca envia duas vezes)
 */

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

// Ordem de "força" do status: um evento atrasado não pode desfazer um mais forte.
const STATUS_RANK: Record<OrderStatus, number> = {
  unknown: 0,
  abandoned: 1,
  pending: 2,
  refused: 3,
  canceled: 3,
  paid: 4,
  refunded: 5,
  chargeback: 6,
};

export function mergeStatus(current: OrderStatus | null, incoming: OrderStatus): OrderStatus {
  if (!current) return incoming;
  // Recusa depois de pendente é válida; pago depois de recusado também (nova tentativa aprovada).
  if (current === "refused" && incoming === "paid") return "paid";
  return STATUS_RANK[incoming] >= STATUS_RANK[current] ? incoming : current;
}

export async function processCaktoWebhook(
  store: IngestStore,
  body: unknown,
  headers: Record<string, string>,
  opts: { workspaceKey?: string | null; sender?: CapiSender; windowMinutes?: number } = {},
): Promise<WebhookResult> {
  const parsed = parseCaktoWebhook(body);

  const ws = await store.findCaktoWorkspace({
    workspaceKey: opts.workspaceKey ?? null,
    secretHash: parsed.secret ? sha256(parsed.secret) : null,
  });

  const signatureValid = Boolean(ws && parsed.secret && safeEqual(parsed.secret, ws.secret));

  if (!ws || !signatureValid) {
    // Registra a tentativa (sem workspace se não identificado) para diagnóstico.
    await store.insertRawCakto({
      workspaceId: ws?.workspaceId ?? null,
      dedupeKey: `invalid|${parsed.dedupeKey}|${Date.now()}`,
      eventName: parsed.eventName,
      orderExternalId: parsed.orderExternalId,
      payload: redactSecret(body),
      headers,
      signatureValid: false,
      warnings: ["Segredo ausente ou inválido"],
    });
    return {
      status: 401,
      body: { ok: false, error: "Segredo do webhook inválido. Confira o segredo copiado da Cakto em Conexões → Cakto." },
    };
  }
  return ingestTrustedCaktoEvent(store, ws.workspaceId, body, headers, opts);
}

/**
 * Grava e processa um evento já autenticado (webhook validado ou pedido vindo
 * da API da Cakto na conciliação). Idempotente pela chave do evento.
 */
export async function ingestTrustedCaktoEvent(
  store: IngestStore,
  workspaceId: string,
  body: unknown,
  headers: Record<string, string>,
  opts: { sender?: CapiSender; windowMinutes?: number } = {},
): Promise<WebhookResult> {
  const parsed = parseCaktoWebhook(body);
  const raw = await store.insertRawCakto({
    workspaceId,
    dedupeKey: parsed.dedupeKey,
    eventName: parsed.eventName,
    orderExternalId: parsed.orderExternalId,
    payload: redactSecret(body),
    headers,
    signatureValid: true,
    warnings: parsed.warnings,
  });
  if (!raw.inserted && raw.alreadyProcessed) return { status: 200, body: { ok: true, duplicate: true } };
  return applyCaktoEvent(store, workspaceId, parsed, raw.id!, opts);
}

/** Reprocessa um evento bruto salvo (ex.: falhou antes por erro de banco). */
export async function reprocessStoredCaktoEvent(
  store: IngestStore,
  workspaceId: string,
  rawId: string,
  payload: unknown,
  opts: { sender?: CapiSender; windowMinutes?: number } = {},
): Promise<WebhookResult> {
  return applyCaktoEvent(store, workspaceId, parseCaktoWebhook(payload), rawId, opts);
}

async function applyCaktoEvent(
  store: IngestStore,
  workspaceId: string,
  parsed: ReturnType<typeof parseCaktoWebhook>,
  rawId: string,
  opts: { sender?: CapiSender; windowMinutes?: number },
): Promise<WebhookResult> {
  const raw = { id: rawId };
  try {
    if (parsed.kind === "test" || parsed.kind === "unknown" || parsed.kind === "checkout_started") {
      await store.markRawProcessed(raw.id!, null);
      return { status: 200, body: { ok: true, processed: false, kind: parsed.kind, warnings: parsed.warnings } };
    }

    const settings = await store.workspaceSettings(workspaceId);
    const externalId = parsed.orderExternalId ?? `abandono_${parsed.dedupeKey.slice(0, 24)}`;
    const existing = await store.getOrder(workspaceId, externalId);
    const status = mergeStatus(existing?.status ?? null, parsed.status);

    const netKnown = parsed.netAmount != null;
    const netAmount = netKnown
      ? parsed.netAmount!
      : round2(parsed.grossAmount * (1 - settings.defaultFeeRate));
    const fees = parsed.fees ?? round2(parsed.grossAmount - netAmount);

    const emailHash = hashEmail(parsed.customerEmail);
    const phoneHash = hashPhone(parsed.customerPhone);
    const createdAt = existing?.createdAt ?? parsed.createdAt ?? new Date().toISOString();

    // Papel do pedido: o produto cadastrado como order bump/upsell manda; senão, o que o payload disser.
    const product = await store.productForCakto(workspaceId, parsed.productExternalId);
    const kindFromProduct = product?.kind === "order_bump" ? "bump" : product?.kind === "upsell" ? "upsell" : null;
    const orderKind = existing?.orderKind && existing.orderKind !== "main" ? existing.orderKind : kindFromProduct ?? parsed.orderKind;
    const gross = parsed.grossAmount || existing?.grossAmount || 0;
    const parts =
      orderKind === "main"
        ? {
            mainAmount: parsed.grossAmount ? parsed.mainAmount : existing?.mainAmount ?? gross,
            bumpAmount: parsed.grossAmount ? parsed.bumpAmount : existing?.bumpAmount ?? 0,
            upsellAmount: parsed.grossAmount ? parsed.upsellAmount : existing?.upsellAmount ?? 0,
          }
        : { mainAmount: 0, bumpAmount: orderKind === "bump" ? gross : 0, upsellAmount: orderKind === "upsell" ? gross : 0 };

    const order: OrderRecord = {
      externalId,
      orderKind,
      ...parts,
      items: parsed.items.length ? parsed.items : existing?.items ?? null,
      productId: existing?.productId ?? product?.id ?? null,
      productExternalId: parsed.productExternalId ?? existing?.productExternalId ?? null,
      productName: parsed.productName ?? existing?.productName ?? null,
      offerId: parsed.offerId ?? existing?.offerId ?? null,
      status,
      paymentMethod: parsed.paymentMethod !== "other" ? parsed.paymentMethod : existing?.paymentMethod ?? "other",
      grossAmount: parsed.grossAmount || existing?.grossAmount || 0,
      fees: parsed.grossAmount ? fees : existing?.fees ?? 0,
      netAmount: parsed.grossAmount ? netAmount : existing?.netAmount ?? 0,
      netEstimated: parsed.grossAmount ? !netKnown : existing?.netEstimated ?? false,
      currency: parsed.currency,
      coupon: parsed.coupon ?? existing?.coupon ?? null,
      isOrderBump: orderKind === "bump",
      isUpsell: orderKind === "upsell",
      parentOrderId: parsed.parentOrderId ?? existing?.parentOrderId ?? null,
      customerName: parsed.customerName ?? existing?.customerName ?? null,
      customerEmail: parsed.customerEmail ?? existing?.customerEmail ?? null,
      customerPhone: parsed.customerPhone ?? existing?.customerPhone ?? null,
      emailHash: emailHash ?? existing?.emailHash ?? null,
      phoneHash: phoneHash ?? existing?.phoneHash ?? null,
      utmSource: parsed.tracking.utmSource ?? existing?.utmSource ?? null,
      utmMedium: parsed.tracking.utmMedium ?? existing?.utmMedium ?? null,
      utmCampaign: parsed.tracking.utmCampaign ?? existing?.utmCampaign ?? null,
      utmContent: parsed.tracking.utmContent ?? existing?.utmContent ?? null,
      utmTerm: parsed.tracking.utmTerm ?? existing?.utmTerm ?? null,
      sck: parsed.tracking.sck ?? existing?.sck ?? null,
      src: parsed.tracking.src ?? existing?.src ?? null,
      fbclid: parsed.tracking.fbclid ?? existing?.fbclid ?? null,
      fbp: parsed.tracking.fbp ?? existing?.fbp ?? null,
      fbc: parsed.tracking.fbc ?? existing?.fbc ?? null,
      sessionId: existing?.sessionId ?? null,
      campaignId: existing?.campaignId ?? null,
      adsetId: existing?.adsetId ?? null,
      adId: existing?.adId ?? null,
      attributionMethod: existing?.attributionMethod ?? "unattributed",
      attributionConfidence: existing?.attributionConfidence ?? 0,
      capiPurchaseSentAt: existing?.capiPurchaseSentAt ?? null,
      createdAt,
      paidAt: status === "paid" ? existing?.paidAt ?? parsed.paidAt ?? new Date().toISOString() : existing?.paidAt ?? null,
      refundedAt:
        status === "refunded" || status === "chargeback"
          ? existing?.refundedAt ?? parsed.refundedAt ?? new Date().toISOString()
          : existing?.refundedAt ?? null,
    };

    // ---- Atribuição (re-tenta enquanto não atribuída; nunca piora uma existente) ----
    if (order.attributionMethod === "unattributed") {
      const lookup: AttributionLookup = {
        sessionById: (id) => store.getSession(workspaceId, id),
        sessionByFbclid: (id) => store.sessionByFbclid(workspaceId, id),
        sessionByEmailHash: (h) => store.sessionByEmailHash(workspaceId, h),
        sessionByPhoneHash: (h) => store.sessionByPhoneHash(workspaceId, h),
        checkoutClicksBetween: (f, t) => store.checkoutClicksBetween(workspaceId, f, t),
      };
      const a = await attributeOrder(
        {
          createdAt,
          sck: order.sck,
          src: order.src,
          utmSource: order.utmSource,
          utmCampaign: order.utmCampaign,
          utmContent: order.utmContent,
          utmTerm: order.utmTerm,
          fbclid: order.fbclid,
          fbc: order.fbc,
          emailHash: order.emailHash,
          phoneHash: order.phoneHash,
        },
        lookup,
        { windowMinutes: opts.windowMinutes },
      );
      order.attributionMethod = a.method;
      order.attributionConfidence = a.confidence;
      order.campaignId = a.campaignId;
      order.adsetId = a.adsetId;
      order.adId = a.adId;
      order.sessionId = a.session?.sessionId ?? null;
      if (a.session) {
        order.utmSource ??= a.utmSource;
        order.utmCampaign ??= a.utmCampaign;
        order.utmContent ??= a.utmContent;
        order.utmTerm ??= a.utmTerm;
        order.fbp ??= a.session.fbp;
        order.fbc ??= a.session.fbc;
      }
    }

    await store.upsertOrder(workspaceId, order);

    // ---- Purchase na CAPI (uma única vez por pedido) ----
    let capi: string = "not_applicable";
    if (status === "paid" && !order.capiPurchaseSentAt) {
      const session = order.sessionId ? await store.getSession(workspaceId, order.sessionId) : null;
      const r = await dispatchCapi(
        store,
        workspaceId,
        {
          // Order bump é parte da mesma compra: vai como evento próprio para não inflar as compras do Meta.
          eventName: order.orderKind === "bump" ? "OrderBump" : "Purchase",
          eventId: `cakto_${externalId}`,
          eventTime: new Date(order.paidAt ?? Date.now()),
          eventSourceUrl: session?.firstUrl ?? parsed.checkoutUrl,
          email: order.customerEmail,
          phone: order.customerPhone,
          fullName: order.customerName,
          externalId: session?.visitorId ?? null,
          clientIp: session?.clientIp ?? parsed.clientIp,
          userAgent: session?.userAgent ?? parsed.clientUserAgent,
          fbp: order.fbp,
          fbc: order.fbc,
          value: order.grossAmount,
          currency: order.currency,
          orderId: externalId,
          contentIds: order.productExternalId ? [order.productExternalId] : undefined,
          contentName: order.productName,
        },
        "cakto",
        { sender: opts.sender },
      );
      capi = r.status;
      if (r.status === "sent" || r.reason === "already_sent") {
        order.capiPurchaseSentAt = new Date().toISOString();
        await store.upsertOrder(workspaceId, order);
      }
    }

    await store.markRawProcessed(raw.id!, null);
    return {
      status: 200,
      body: {
        ok: true,
        order: externalId,
        status,
        attribution: order.attributionMethod,
        capi,
        warnings: parsed.warnings,
      },
    };
  } catch (e) {
    await store.markRawProcessed(raw.id!, (e as Error).message);
    // 500 faz a Cakto reenviar; a idempotência evita duplicar quando reenviar.
    return { status: 500, body: { ok: false, error: "Falha ao processar; o evento bruto foi salvo para reprocessar." } };
  }
}

function redactSecret(body: unknown): unknown {
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const copy = { ...(body as Record<string, unknown>) };
    if ("secret" in copy) copy.secret = "[removido]";
    return copy;
  }
  return body;
}

function round2(v: number) {
  return Math.round(v * 100) / 100;
}
