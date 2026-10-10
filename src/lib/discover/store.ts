import type { AdReference, KitInputs, KitRoot, KitSection, KitSectionKind, NicheSeed, ReferenceAnalysis, ReferenceInput, SwipeCollection } from "./types";

/**
 * Armazenamento do Descobrir & Criar. Usa as tabelas que já existem no banco
 * (niches, ad_references, swipe_collections, campaign_kits) — sem migração nova.
 *  - Kit = linha de campaign_kits com kind "kit"; cada seção é uma linha com o
 *    kind da seção, content.kit_id e versão (nova versão = nova linha).
 */
export interface DiscoverStore {
  readonly mode: "demo" | "live";
  listReferences(): Promise<AdReference[]>;
  getReference(id: string): Promise<AdReference | null>;
  addReference(input: ReferenceInput & { source?: AdReference["source"]; libraryId?: string | null }): Promise<AdReference>;
  setReferenceAnalysis(id: string, analysis: ReferenceAnalysis): Promise<void>;
  deleteReference(id: string): Promise<void>;

  getNicheSeed(slug: string): Promise<NicheSeed | null>;
  listNicheSeeds(): Promise<Map<string, NicheSeed>>;
  saveNicheSeed(slug: string, name: string, sensitive: boolean, seed: NicheSeed): Promise<void>;

  listCollections(): Promise<SwipeCollection[]>;
  createCollection(name: string): Promise<SwipeCollection>;
  addToCollection(collectionId: string, refId: string, note: string | null): Promise<void>;
  removeFromCollection(collectionId: string, refId: string): Promise<void>;

  listKits(): Promise<KitRoot[]>;
  getKit(id: string): Promise<{ kit: KitRoot; sections: KitSection[] } | null>;
  createKit(input: { title: string; nicheSlug: string; subnicheSlug: string | null; referenceIds: string[]; inputs: KitInputs }): Promise<KitRoot>;
  updateKit(id: string, patch: Partial<Pick<KitRoot, "title" | "inputs" | "productId" | "referenceIds">>): Promise<void>;
  /** Salva uma nova versão da seção e devolve o número da versão. */
  saveSection(kitId: string, kind: KitSectionKind, format: KitSection["format"], data: unknown, note: string | null): Promise<number>;
  deleteKit(id: string): Promise<void>;
}

/** Última versão de cada seção. */
export function latestSections(sections: KitSection[]): Map<KitSectionKind, KitSection> {
  const m = new Map<KitSectionKind, KitSection>();
  for (const s of sections) {
    const cur = m.get(s.kind);
    if (!cur || s.version > cur.version) m.set(s.kind, s);
  }
  return m;
}

export function normalizeRefInput(i: ReferenceInput): ReferenceInput {
  const t = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    sourceUrl: t(i.sourceUrl),
    nicheSlug: t(i.nicheSlug),
    subnicheSlug: t(i.subnicheSlug),
    advertiser: t(i.advertiser),
    format: i.format ?? "unknown",
    firstSeen: i.firstSeen && /^\d{4}-\d{2}-\d{2}$/.test(i.firstSeen) ? i.firstSeen : null,
    variations: i.variations != null && Number.isFinite(i.variations) && i.variations >= 0 ? Math.round(i.variations) : null,
    country: t(i.country),
    price: i.price != null && Number.isFinite(i.price) && i.price > 0 ? Math.round(i.price * 100) / 100 : null,
    copy: t(i.copy),
    hook: t(i.hook),
    angle: t(i.angle),
    cta: t(i.cta),
    landingType: t(i.landingType),
    landingUrl: t(i.landingUrl),
    notes: t(i.notes),
    tags: (i.tags ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 20),
  };
}

// ------------------------------- memória (modo demo) -------------------------------

const uid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export class MemoryDiscoverStore implements DiscoverStore {
  readonly mode = "demo" as const;
  refs = new Map<string, AdReference>();
  seeds = new Map<string, NicheSeed>();
  collections = new Map<string, SwipeCollection>();
  kits = new Map<string, KitRoot>();
  sections: KitSection[] = [];

  async listReferences() {
    return [...this.refs.values()].sort((a, b) => b.collectedAt.localeCompare(a.collectedAt));
  }
  async getReference(id: string) {
    return this.refs.get(id) ?? null;
  }
  async addReference(input: ReferenceInput & { source?: AdReference["source"]; libraryId?: string | null }) {
    const n = normalizeRefInput(input);
    const ref: AdReference = {
      id: uid(),
      source: input.source ?? "manual",
      sourceUrl: n.sourceUrl ?? null,
      libraryId: input.libraryId ?? null,
      nicheSlug: n.nicheSlug ?? null,
      subnicheSlug: n.subnicheSlug ?? null,
      advertiser: n.advertiser ?? null,
      format: n.format ?? "unknown",
      firstSeen: n.firstSeen ?? null,
      variations: n.variations ?? null,
      country: n.country ?? null,
      price: n.price ?? null,
      copy: n.copy ?? null,
      hook: n.hook ?? null,
      angle: n.angle ?? null,
      cta: n.cta ?? null,
      landingType: n.landingType ?? null,
      landingUrl: n.landingUrl ?? null,
      notes: n.notes ?? null,
      tags: n.tags ?? [],
      analysis: null,
      collectedAt: new Date().toISOString(),
    };
    this.refs.set(ref.id, ref);
    return ref;
  }
  async setReferenceAnalysis(id: string, analysis: ReferenceAnalysis) {
    const r = this.refs.get(id);
    if (r) r.analysis = analysis;
  }
  async deleteReference(id: string) {
    this.refs.delete(id);
    for (const c of this.collections.values()) c.items = c.items.filter((i) => i.refId !== id);
  }
  async getNicheSeed(slug: string) {
    return this.seeds.get(slug) ?? null;
  }
  async listNicheSeeds() {
    return new Map(this.seeds);
  }
  async saveNicheSeed(slug: string, _name: string, _sensitive: boolean, seed: NicheSeed) {
    this.seeds.set(slug, seed);
  }
  async listCollections() {
    return [...this.collections.values()];
  }
  async createCollection(name: string) {
    const c: SwipeCollection = { id: uid(), name: name.trim() || "Coleção", items: [], createdAt: new Date().toISOString() };
    this.collections.set(c.id, c);
    return c;
  }
  async addToCollection(collectionId: string, refId: string, note: string | null) {
    const c = this.collections.get(collectionId);
    if (c && !c.items.some((i) => i.refId === refId)) c.items.push({ refId, note, addedAt: new Date().toISOString() });
  }
  async removeFromCollection(collectionId: string, refId: string) {
    const c = this.collections.get(collectionId);
    if (c) c.items = c.items.filter((i) => i.refId !== refId);
  }
  async listKits() {
    return [...this.kits.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getKit(id: string) {
    const kit = this.kits.get(id);
    return kit ? { kit, sections: this.sections.filter((s) => s.kitId === id) } : null;
  }
  async createKit(input: { title: string; nicheSlug: string; subnicheSlug: string | null; referenceIds: string[]; inputs: KitInputs }) {
    const now = new Date().toISOString();
    const kit: KitRoot = { id: uid(), productId: null, createdAt: now, updatedAt: now, ...input };
    this.kits.set(kit.id, kit);
    return kit;
  }
  async updateKit(id: string, patch: Partial<Pick<KitRoot, "title" | "inputs" | "productId" | "referenceIds">>) {
    const k = this.kits.get(id);
    if (k) Object.assign(k, patch, { updatedAt: new Date().toISOString() });
  }
  async saveSection(kitId: string, kind: KitSectionKind, format: KitSection["format"], data: unknown, note: string | null) {
    const version = Math.max(0, ...this.sections.filter((s) => s.kitId === kitId && s.kind === kind).map((s) => s.version)) + 1;
    this.sections.push({ id: uid(), kitId, kind, version, format, data, note, createdAt: new Date().toISOString() });
    const k = this.kits.get(kitId);
    if (k) k.updatedAt = new Date().toISOString();
    return version;
  }
  async deleteKit(id: string) {
    this.kits.delete(id);
    this.sections = this.sections.filter((s) => s.kitId !== id);
  }
}
