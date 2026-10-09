import type { AttributionMethod } from "@/lib/data/types";

/**
 * Atribuição de vendas da Cakto a campanha/conjunto/anúncio.
 * Ordem de prioridade (com confiança):
 *  1. checkout_param — o identificador de sessão que o script anexou ao link
 *     de checkout (sck/src) voltou no pedido → 0,95
 *  2. utm_ids — o pedido trouxe UTMs com IDs do Meta ({{campaign.id}} etc.) → 0,9
 *  3. fbclid — fbclid/fbc do pedido casa com uma sessão rastreada → 0,85
 *  4. email_hash / phone_hash — e-mail/telefone (hash) casa com evento anterior → 0,7 / 0,65
 *  5. time_window — único clique de checkout em X min antes do pedido → 0,4
 *     (vários cliques no intervalo: o mais recente, 0,25)
 * Sem origem: "unattributed" (nunca descartar).
 */

export interface SessionRef {
  sessionId: string;
  visitorId: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  fbclid: string | null;
  fbp: string | null;
  fbc: string | null;
  clientIp: string | null;
  userAgent: string | null;
  lastSeenAt: string;
}

export interface OrderForAttribution {
  createdAt: string;
  sck: string | null;
  src: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
  fbclid: string | null;
  fbc: string | null;
  emailHash: string | null;
  phoneHash: string | null;
}

export interface AttributionLookup {
  sessionById(id: string): Promise<SessionRef | null>;
  sessionByFbclid(fbclid: string): Promise<SessionRef | null>;
  sessionByEmailHash(hash: string): Promise<SessionRef | null>;
  sessionByPhoneHash(hash: string): Promise<SessionRef | null>;
  /** Sessões com clique de checkout entre [from, to], mais recente primeiro. */
  checkoutClicksBetween(fromIso: string, toIso: string): Promise<SessionRef[]>;
}

export interface AttributionResult {
  method: AttributionMethod;
  confidence: number;
  session: SessionRef | null;
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  utmSource: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
}

/** Extrai um ID numérico do Meta de "Nome|1202..." ou "1202..." */
export function extractMetaId(v: string | null | undefined): string | null {
  if (!v) return null;
  const decoded = safeDecode(v);
  const parts = decoded.split(/[|:]/).map((s) => s.trim());
  for (let i = parts.length - 1; i >= 0; i--) if (/^\d{6,}$/.test(parts[i])) return parts[i];
  return null;
}

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v.replace(/\+/g, " "));
  } catch {
    return v;
  }
}

/** fbc = fb.1.<timestamp>.<fbclid> */
export function fbclidFromFbc(fbc: string | null | undefined): string | null {
  if (!fbc) return null;
  const parts = fbc.split(".");
  return parts.length >= 4 ? parts.slice(3).join(".") : null;
}

function fromUtms(u: {
  utmSource: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
}) {
  return {
    campaignId: extractMetaId(u.utmCampaign),
    adsetId: extractMetaId(u.utmTerm),
    adId: extractMetaId(u.utmContent),
  };
}

function result(method: AttributionMethod, confidence: number, s: SessionRef | null, o?: OrderForAttribution): AttributionResult {
  const utm = s ?? {
    utmSource: o?.utmSource ?? null,
    utmCampaign: o?.utmCampaign ?? null,
    utmContent: o?.utmContent ?? null,
    utmTerm: o?.utmTerm ?? null,
  };
  const ids = fromUtms(utm);
  return {
    method,
    confidence,
    session: s,
    ...ids,
    utmSource: utm.utmSource,
    utmCampaign: utm.utmCampaign,
    utmContent: utm.utmContent,
    utmTerm: utm.utmTerm,
  };
}

export async function attributeOrder(
  order: OrderForAttribution,
  lookup: AttributionLookup,
  opts: { windowMinutes?: number } = {},
): Promise<AttributionResult> {
  const windowMinutes = opts.windowMinutes ?? 60;

  // 1) parâmetro próprio no checkout
  for (const id of [order.sck, order.src]) {
    if (!id) continue;
    const s = await lookup.sessionById(id);
    if (s) return result("checkout_param", 0.95, s);
  }

  // 2) UTMs com IDs do Meta no próprio pedido
  const orderIds = fromUtms(order);
  if (orderIds.campaignId || orderIds.adId) return result("utm_ids", 0.9, null, order);

  // 3) fbclid / fbc
  const fbclid = order.fbclid ?? fbclidFromFbc(order.fbc);
  if (fbclid) {
    const s = await lookup.sessionByFbclid(fbclid);
    if (s) return result("fbclid", 0.85, s);
  }

  // 4) e-mail / telefone com hash
  if (order.emailHash) {
    const s = await lookup.sessionByEmailHash(order.emailHash);
    if (s) return result("email_hash", 0.7, s);
  }
  if (order.phoneHash) {
    const s = await lookup.sessionByPhoneHash(order.phoneHash);
    if (s) return result("phone_hash", 0.65, s);
  }

  // 5) janela de tempo (último recurso)
  const to = new Date(order.createdAt);
  if (!Number.isNaN(to.getTime())) {
    const from = new Date(to.getTime() - windowMinutes * 60000);
    const clicks = await lookup.checkoutClicksBetween(from.toISOString(), to.toISOString());
    const unique = dedupeSessions(clicks);
    if (unique.length === 1) return result("time_window", 0.4, unique[0]);
    if (unique.length > 1) return result("time_window", 0.25, unique[0]);
  }

  // UTMs sem IDs ainda contam como origem conhecida, mas sem anúncio
  if (order.utmSource || order.utmCampaign) {
    return { ...result("unattributed", 0, null, order) };
  }
  return result("unattributed", 0, null);
}

function dedupeSessions(list: SessionRef[]): SessionRef[] {
  const seen = new Set<string>();
  const out: SessionRef[] = [];
  for (const s of list) {
    if (seen.has(s.sessionId)) continue;
    seen.add(s.sessionId);
    out.push(s);
  }
  return out;
}

export const ATTRIBUTION_LABEL: Record<AttributionMethod, string> = {
  checkout_param: "Parâmetro no checkout",
  utm_ids: "UTMs com IDs",
  fbclid: "fbclid/fbc",
  email_hash: "E-mail (hash)",
  phone_hash: "Telefone (hash)",
  time_window: "Janela de tempo",
  unattributed: "Não atribuída",
};
