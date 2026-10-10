import { z } from "zod";
import { extractMetaId } from "@/lib/attribution/attribute";
import { hashEmail, hashPhone } from "@/lib/crypto";
import { BROWSER_EVENTS_TO_CAPI, fbcFromFbclid, type CapiEventName } from "@/lib/integrations/meta/capi";
import { dispatchCapi, type CapiSender } from "./capi-dispatch";
import type { IngestStore, SessionRecord } from "./store";

/**
 * Processa um evento enviado pelo script de tracking (t.js).
 * Eventos padrão do Meta são reenviados pela CAPI com o MESMO event_id que o
 * Pixel usou no navegador (deduplicação).
 */

const str = (max = 2048) => z.string().max(max).nullish();

export const CollectSchema = z.object({
  site: z.string().min(4).max(64),
  event: z.string().min(1).max(64),
  event_id: z.string().min(4).max(128),
  sid: z.string().min(4).max(128),
  vid: z.string().max(128).nullish(),
  url: str(),
  ref: str(),
  utm_source: str(256),
  utm_medium: str(256),
  utm_campaign: str(512),
  utm_content: str(512),
  utm_term: str(512),
  fbclid: str(512),
  fbp: str(256),
  fbc: str(512),
  device: str(32),
  email: str(320),
  phone: str(64),
  consent: z.boolean().nullish(),
  props: z.record(z.string(), z.unknown()).nullish(),
});

export type CollectPayload = z.infer<typeof CollectSchema>;

export interface CollectResult {
  ok: boolean;
  status: number;
  error?: string;
  duplicate?: boolean;
  /** Função a executar após responder (envio CAPI), para não atrasar o navegador. */
  afterResponse?: () => Promise<void>;
}

/** Host pertence ao domínio cadastrado do site (o próprio domínio ou subdomínio). */
export function hostMatches(domain: string, candidate: string | null | undefined): boolean | null {
  if (!candidate) return null;
  let host: string;
  try {
    host = new URL(candidate).hostname.toLowerCase();
  } catch {
    return null;
  }
  const d = domain.toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "").replace(/^www\./, "");
  const h = host.replace(/^www\./, "");
  if (process.env.NODE_ENV !== "production" && (h === "localhost" || h === "127.0.0.1")) return true;
  return h === d || h.endsWith(`.${d}`);
}

// ---- limite de taxa por IP+site (melhor esforço: memória da instância) ----
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 120;
const buckets = new Map<string, { start: number; n: number }>();
export function rateLimited(key: string, nowMs = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || nowMs - b.start > RATE_WINDOW_MS) {
    buckets.set(key, { start: nowMs, n: 1 });
    if (buckets.size > 20_000) for (const [k, v] of buckets) if (nowMs - v.start > RATE_WINDOW_MS) buckets.delete(k);
    return false;
  }
  b.n++;
  return b.n > RATE_MAX;
}

export async function processCollect(
  store: IngestStore,
  raw: unknown,
  meta: { ip: string | null; userAgent: string | null; now?: Date; origin?: string | null },
  opts: { sender?: CapiSender } = {},
): Promise<CollectResult> {
  const parsed = CollectSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, status: 400, error: "payload inválido" };
  const p = parsed.data;
  if (meta.ip && rateLimited(`${meta.ip}|${p.site}`, meta.now?.getTime())) return { ok: false, status: 429, error: "muitos eventos" };
  const found = await store.findSiteByPublicKey(p.site);
  if (!found) return { ok: false, status: 404, error: "site não encontrado" };
  const { workspaceId, site } = found;
  // Domínio cadastrado: rejeita eventos de outra origem (evita poluição dos dados por terceiros)
  if (site.domain) {
    const checks = [hostMatches(site.domain, meta.origin), hostMatches(site.domain, p.url)].filter((x) => x != null);
    if (checks.some((x) => x === false)) return { ok: false, status: 403, error: "domínio não autorizado para este site" };
  }
  const now = (meta.now ?? new Date()).toISOString();

  // Respeita consentimento quando o site exige
  if (site.consentMode === "required" && p.consent !== true) {
    return { ok: true, status: 204 };
  }

  const fbc = p.fbc ?? (p.fbclid ? fbcFromFbclid(p.fbclid, meta.now) : null);

  // ---- sessão (first-touch para UTMs; atualiza last_seen e identificadores) ----
  const existing = await store.getSession(workspaceId, p.sid);
  const session: SessionRecord = existing
    ? {
        ...existing,
        visitorId: existing.visitorId ?? p.vid ?? null,
        fbclid: existing.fbclid ?? p.fbclid ?? null,
        fbp: p.fbp ?? existing.fbp,
        fbc: existing.fbc ?? fbc,
        clientIp: meta.ip ?? existing.clientIp,
        userAgent: meta.userAgent ?? existing.userAgent,
        emailHash: hashEmail(p.email) ?? existing.emailHash,
        phoneHash: hashPhone(p.phone) ?? existing.phoneHash,
        lastSeenAt: now,
      }
    : {
        sessionId: p.sid,
        siteId: site.id,
        visitorId: p.vid ?? null,
        firstUrl: p.url ?? null,
        referrer: p.ref ?? null,
        utmSource: p.utm_source ?? null,
        utmMedium: p.utm_medium ?? null,
        utmCampaign: p.utm_campaign ?? null,
        utmContent: p.utm_content ?? null,
        utmTerm: p.utm_term ?? null,
        fbclid: p.fbclid ?? null,
        fbp: p.fbp ?? null,
        fbc,
        clientIp: meta.ip,
        userAgent: meta.userAgent,
        device: p.device ?? null,
        emailHash: hashEmail(p.email),
        phoneHash: hashPhone(p.phone),
        startedAt: now,
        lastSeenAt: now,
      };
  await store.upsertSession(workspaceId, session);

  // no_capi: o Pixel do próprio usuário já disparou este evento sem event_id (evita duplicar).
  const isMetaEvent = BROWSER_EVENTS_TO_CAPI.has(p.event as CapiEventName) && Boolean(site.pixelId) && p.props?.no_capi !== true;
  const inserted = await store.insertEvent(workspaceId, {
    siteId: site.id,
    eventName: p.event,
    eventId: p.event_id,
    sessionId: p.sid,
    visitorId: p.vid ?? null,
    url: p.url ?? null,
    referrer: p.ref ?? null,
    utmSource: p.utm_source ?? session.utmSource,
    utmMedium: p.utm_medium ?? session.utmMedium,
    utmCampaign: p.utm_campaign ?? session.utmCampaign,
    utmContent: p.utm_content ?? session.utmContent,
    utmTerm: p.utm_term ?? session.utmTerm,
    fbclid: p.fbclid ?? session.fbclid,
    fbp: p.fbp ?? session.fbp,
    fbc: fbc ?? session.fbc,
    clientIp: meta.ip,
    userAgent: meta.userAgent,
    props: {
      ...(p.props ?? {}),
      campaign_id: extractMetaId(session.utmCampaign),
      ad_id: extractMetaId(session.utmContent),
    },
    capiStatus: isMetaEvent ? "pending" : null,
    createdAt: now,
  });
  if (!inserted) return { ok: true, status: 200, duplicate: true };

  if (!isMetaEvent) return { ok: true, status: 200 };

  const afterResponse = async () => {
    const r = await dispatchCapi(
      store,
      workspaceId,
      {
        eventName: p.event as CapiEventName,
        eventId: p.event_id,
        eventTime: meta.now ?? new Date(),
        eventSourceUrl: p.url ?? null,
        email: p.email ?? null,
        phone: p.phone ?? null,
        externalId: p.vid ?? null,
        clientIp: meta.ip,
        userAgent: meta.userAgent,
        fbp: session.fbp,
        fbc: session.fbc,
      },
      "tracking",
      { pixelId: site.pixelId, sender: opts.sender },
    );
    await store.updateEventCapiStatus(workspaceId, site.id, p.event_id, p.event, r.status);
  };
  return { ok: true, status: 200, afterResponse };
}
