import type { ProductKind, TrackingSite } from "@/lib/data/types";
import type {
  CapiConfig,
  CapiLogEntry,
  EventRecord,
  IngestStore,
  OrderRecord,
  RawCaktoInsert,
  SessionRecord,
  WorkspaceSettings,
} from "./store";

/**
 * Store em memória: usado nos testes e no modo demo local (sem Supabase),
 * para o usuário poder testar o script e o webhook antes de configurar tudo.
 * Os dados somem ao reiniciar o servidor.
 */

interface WsData {
  sessions: Map<string, SessionRecord>;
  events: EventRecord[];
  orders: Map<string, OrderRecord>;
  capiLogs: Array<CapiLogEntry & { createdAt: string }>;
  raw: Array<RawCaktoInsert & { id: string; processed: boolean; error: string | null; receivedAt: string }>;
}

export class MemoryIngestStore implements IngestStore {
  sites = new Map<string, { workspaceId: string; site: TrackingSite }>();
  cakto = new Map<string, { secret: string; secretHash: string }>(); // por workspace
  capi = new Map<string, CapiConfig>();
  settings = new Map<string, WorkspaceSettings>();
  productMap = new Map<string, { id: string; kind: ProductKind }>(); // `${ws}|${caktoProductId}` -> produto
  data = new Map<string, WsData>();
  private seq = 0;

  ws(id: string): WsData {
    let d = this.data.get(id);
    if (!d) {
      d = { sessions: new Map(), events: [], orders: new Map(), capiLogs: [], raw: [] };
      this.data.set(id, d);
    }
    return d;
  }

  async findSiteByPublicKey(publicKey: string) {
    return this.sites.get(publicKey) ?? null;
  }
  async getSession(workspaceId: string, sessionId: string) {
    return this.ws(workspaceId).sessions.get(sessionId) ?? null;
  }
  async upsertSession(workspaceId: string, s: SessionRecord) {
    this.ws(workspaceId).sessions.set(s.sessionId, s);
  }
  async insertEvent(workspaceId: string, e: EventRecord) {
    const d = this.ws(workspaceId);
    if (d.events.some((x) => x.siteId === e.siteId && x.eventId === e.eventId && x.eventName === e.eventName)) return false;
    d.events.push(e);
    if (d.events.length > 5000) d.events.splice(0, d.events.length - 5000);
    return true;
  }
  async updateEventCapiStatus(workspaceId: string, siteId: string, eventId: string, eventName: string, status: EventRecord["capiStatus"]) {
    const e = this.ws(workspaceId).events.find((x) => x.siteId === siteId && x.eventId === eventId && x.eventName === eventName);
    if (e) e.capiStatus = status;
  }

  private latest(list: SessionRecord[]): SessionRecord | null {
    return list.sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0] ?? null;
  }
  async sessionByFbclid(workspaceId: string, fbclid: string) {
    return this.latest([...this.ws(workspaceId).sessions.values()].filter((s) => s.fbclid === fbclid));
  }
  async sessionByEmailHash(workspaceId: string, hash: string) {
    return this.latest([...this.ws(workspaceId).sessions.values()].filter((s) => s.emailHash === hash));
  }
  async sessionByPhoneHash(workspaceId: string, hash: string) {
    return this.latest([...this.ws(workspaceId).sessions.values()].filter((s) => s.phoneHash === hash));
  }
  async checkoutClicksBetween(workspaceId: string, fromIso: string, toIso: string) {
    const d = this.ws(workspaceId);
    const clicks = d.events
      .filter((e) => e.eventName === "InitiateCheckout" && e.createdAt >= fromIso && e.createdAt <= toIso && e.sessionId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const out: SessionRecord[] = [];
    for (const c of clicks) {
      const s = d.sessions.get(c.sessionId!);
      if (s) out.push(s);
    }
    return out;
  }

  async findCaktoWorkspace(opts: { workspaceKey?: string | null; secretHash?: string | null }) {
    if (opts.workspaceKey) {
      const c = this.cakto.get(opts.workspaceKey);
      return c ? { workspaceId: opts.workspaceKey, secret: c.secret } : null;
    }
    for (const [ws, c] of this.cakto) if (c.secretHash === opts.secretHash) return { workspaceId: ws, secret: c.secret };
    return null;
  }
  async insertRawCakto(r: RawCaktoInsert) {
    const d = this.ws(r.workspaceId ?? "_unknown");
    const prev = r.workspaceId ? d.raw.find((x) => x.dedupeKey === r.dedupeKey) : undefined;
    if (prev) return { inserted: false, id: prev.id, alreadyProcessed: prev.processed };
    const id = String(++this.seq);
    d.raw.push({ ...r, id, processed: false, error: null, receivedAt: new Date().toISOString() });
    return { inserted: true, id, alreadyProcessed: false };
  }
  async markRawProcessed(id: string, error: string | null) {
    for (const d of this.data.values()) {
      const r = d.raw.find((x) => x.id === id);
      if (r) {
        r.processed = !error;
        r.error = error;
      }
    }
  }
  async getOrder(workspaceId: string, externalId: string) {
    return this.ws(workspaceId).orders.get(externalId) ?? null;
  }
  async upsertOrder(workspaceId: string, o: OrderRecord) {
    this.ws(workspaceId).orders.set(o.externalId, { ...o });
  }
  async productForCakto(workspaceId: string, caktoProductId: string | null) {
    if (!caktoProductId) return null;
    return this.productMap.get(`${workspaceId}|${caktoProductId}`) ?? null;
  }
  async workspaceSettings(workspaceId: string) {
    return this.settings.get(workspaceId) ?? { timezone: "America/Cuiaba", defaultFeeRate: 0.0699, currency: "BRL" };
  }
  async capiConfig(workspaceId: string) {
    return this.capi.get(workspaceId) ?? null;
  }
  async logCapi(workspaceId: string, entry: CapiLogEntry) {
    const d = this.ws(workspaceId);
    const existing = d.capiLogs.find((l) => l.eventName === entry.eventName && l.eventId === entry.eventId);
    if (existing?.status === "sent") return false;
    if (existing) Object.assign(existing, entry);
    else d.capiLogs.push({ ...entry, createdAt: new Date().toISOString() });
    return true;
  }
  async wasCapiSent(workspaceId: string, eventName: string, eventId: string) {
    return this.ws(workspaceId).capiLogs.some((l) => l.eventName === eventName && l.eventId === eventId && l.status === "sent");
  }
}

// Singleton por processo para o modo demo local.
const g = globalThis as unknown as { __ccMemoryStore?: MemoryIngestStore };
export function getMemoryStore(): MemoryIngestStore {
  if (!g.__ccMemoryStore) g.__ccMemoryStore = new MemoryIngestStore();
  return g.__ccMemoryStore;
}
