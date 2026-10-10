import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findNiche } from "./niches";
import { normalizeRefInput, type DiscoverStore } from "./store";
import type { AdReference, KitInputs, KitRoot, KitSection, KitSectionKind, NicheSeed, ReferenceAnalysis, ReferenceInput, SwipeCollection } from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any */

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

function refFromRow(r: any, slugById: Map<string, string>): AdReference {
  const d = r.data ?? {};
  return {
    id: r.id,
    source: r.source,
    sourceUrl: r.source_url ?? null,
    libraryId: d.libraryId ?? null,
    nicheSlug: (r.niche_id && slugById.get(r.niche_id)) ?? d.nicheSlug ?? null,
    subnicheSlug: d.subnicheSlug ?? null,
    advertiser: r.advertiser ?? null,
    format: (r.format as AdReference["format"]) ?? "unknown",
    firstSeen: r.first_seen ? String(r.first_seen).slice(0, 10) : null,
    variations: d.variations ?? null,
    country: d.country ?? null,
    price: d.price ?? null,
    copy: d.copy ?? null,
    hook: d.hook ?? null,
    angle: d.angle ?? null,
    cta: d.cta ?? null,
    landingType: d.landingType ?? null,
    landingUrl: d.landingUrl ?? null,
    notes: d.notes ?? null,
    tags: Array.isArray(d.tags) ? d.tags : [],
    analysis: r.analysis ?? null,
    collectedAt: r.collected_at,
  };
}

/** Implementação real (RLS do usuário logado). */
export class SupabaseDiscoverStore implements DiscoverStore {
  readonly mode = "live" as const;
  constructor(
    private db: SupabaseClient,
    private ws: string,
  ) {}

  /** Garante a linha do nicho (catálogo) e devolve o id. */
  private async nicheId(slug: string | null | undefined): Promise<string | null> {
    if (!slug) return null;
    const n = findNiche(slug);
    const { data } = await this.db.from("niches").select("id").eq("workspace_id", this.ws).eq("slug", slug).maybeSingle();
    if (data?.id) return data.id as string;
    const ins = await this.db
      .from("niches")
      .insert({ workspace_id: this.ws, slug, name: n?.name ?? slug, sensitive: n?.policy.level === "alto", source: "catalog" })
      .select("id")
      .single();
    return check(ins, "criar nicho")?.id ?? null;
  }

  private async slugMap(): Promise<Map<string, string>> {
    const { data } = await this.db.from("niches").select("id, slug").eq("workspace_id", this.ws);
    return new Map((data ?? []).map((r: any) => [r.id as string, r.slug as string]));
  }

  async listReferences() {
    const [res, slugs] = await Promise.all([
      this.db.from("ad_references").select("*").eq("workspace_id", this.ws).order("collected_at", { ascending: false }).limit(1000),
      this.slugMap(),
    ]);
    return (check(res, "listar referências") ?? []).map((r: any) => refFromRow(r, slugs));
  }

  async getReference(id: string) {
    const [res, slugs] = await Promise.all([this.db.from("ad_references").select("*").eq("workspace_id", this.ws).eq("id", id).maybeSingle(), this.slugMap()]);
    const r = check(res, "ler referência");
    return r ? refFromRow(r, slugs) : null;
  }

  async addReference(input: ReferenceInput & { source?: AdReference["source"]; libraryId?: string | null }) {
    const n = normalizeRefInput(input);
    const nicheId = await this.nicheId(n.nicheSlug);
    const row = {
      workspace_id: this.ws,
      niche_id: nicheId,
      source: input.source ?? "manual",
      source_url: n.sourceUrl,
      advertiser: n.advertiser,
      format: n.format,
      first_seen: n.firstSeen,
      data: {
        libraryId: input.libraryId ?? null,
        nicheSlug: n.nicheSlug,
        subnicheSlug: n.subnicheSlug,
        variations: n.variations,
        country: n.country,
        price: n.price,
        copy: n.copy,
        hook: n.hook,
        angle: n.angle,
        cta: n.cta,
        landingType: n.landingType,
        landingUrl: n.landingUrl,
        notes: n.notes,
        tags: n.tags,
      },
    };
    const res = await this.db.from("ad_references").insert(row).select("*").single();
    return refFromRow(check(res, "salvar referência"), new Map(nicheId && n.nicheSlug ? [[nicheId, n.nicheSlug]] : []));
  }

  async setReferenceAnalysis(id: string, analysis: ReferenceAnalysis) {
    check(await this.db.from("ad_references").update({ analysis }).eq("workspace_id", this.ws).eq("id", id), "salvar análise");
  }

  async deleteReference(id: string) {
    check(await this.db.from("ad_references").delete().eq("workspace_id", this.ws).eq("id", id), "excluir referência");
    for (const c of await this.listCollections()) {
      if (c.items.some((i) => i.refId === id)) await this.removeFromCollection(c.id, id);
    }
  }

  async getNicheSeed(slug: string) {
    const { data } = await this.db.from("niches").select("score").eq("workspace_id", this.ws).eq("slug", slug).maybeSingle();
    return (data?.score?.seed as NicheSeed | undefined) ?? null;
  }

  async listNicheSeeds() {
    const { data } = await this.db.from("niches").select("slug, score").eq("workspace_id", this.ws);
    const m = new Map<string, NicheSeed>();
    for (const r of data ?? []) if ((r as any).score?.seed) m.set((r as any).slug, (r as any).score.seed);
    return m;
  }

  async saveNicheSeed(slug: string, name: string, sensitive: boolean, seed: NicheSeed) {
    check(
      await this.db
        .from("niches")
        .upsert({ workspace_id: this.ws, slug, name, sensitive, source: "ai_estimate", score: { seed } }, { onConflict: "workspace_id,slug" }),
      "salvar estimativa",
    );
  }

  async listCollections() {
    const res = await this.db.from("swipe_collections").select("*").eq("workspace_id", this.ws).order("created_at");
    return (check(res, "listar coleções") ?? []).map((r: any): SwipeCollection => ({ id: r.id, name: r.name, items: Array.isArray(r.items) ? r.items : [], createdAt: r.created_at }));
  }

  async createCollection(name: string) {
    const res = await this.db.from("swipe_collections").insert({ workspace_id: this.ws, name: name.trim() || "Coleção", items: [] }).select("*").single();
    const r = check(res, "criar coleção");
    return { id: r.id, name: r.name, items: [], createdAt: r.created_at };
  }

  private async setItems(collectionId: string, items: SwipeCollection["items"]) {
    check(await this.db.from("swipe_collections").update({ items }).eq("workspace_id", this.ws).eq("id", collectionId), "atualizar coleção");
  }

  async addToCollection(collectionId: string, refId: string, note: string | null) {
    const c = (await this.listCollections()).find((x) => x.id === collectionId);
    if (!c || c.items.some((i) => i.refId === refId)) return;
    await this.setItems(collectionId, [...c.items, { refId, note, addedAt: new Date().toISOString() }]);
  }

  async removeFromCollection(collectionId: string, refId: string) {
    const c = (await this.listCollections()).find((x) => x.id === collectionId);
    if (c) await this.setItems(collectionId, c.items.filter((i) => i.refId !== refId));
  }

  private kitFromRow(r: any): KitRoot {
    const c = r.content ?? {};
    return {
      id: r.id,
      title: c.title ?? "Kit",
      nicheSlug: c.nicheSlug ?? "",
      subnicheSlug: c.subnicheSlug ?? null,
      referenceIds: Array.isArray(c.referenceIds) ? c.referenceIds : [],
      productId: r.product_id ?? null,
      inputs: c.inputs ?? {},
      createdAt: r.created_at,
      updatedAt: c.updatedAt ?? r.created_at,
    };
  }

  async listKits() {
    const res = await this.db.from("campaign_kits").select("*").eq("workspace_id", this.ws).eq("kind", "kit").order("created_at", { ascending: false });
    return (check(res, "listar kits") ?? []).map((r: any) => this.kitFromRow(r)).sort((a: KitRoot, b: KitRoot) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getKit(id: string) {
    const [root, secs] = await Promise.all([
      this.db.from("campaign_kits").select("*").eq("workspace_id", this.ws).eq("kind", "kit").eq("id", id).maybeSingle(),
      this.db.from("campaign_kits").select("*").eq("workspace_id", this.ws).neq("kind", "kit").eq("content->>kit_id", id).order("version"),
    ]);
    const r = check(root, "ler kit");
    if (!r) return null;
    const sections: KitSection[] = (check(secs, "ler seções") ?? []).map((s: any) => ({
      id: s.id,
      kitId: id,
      kind: s.kind as KitSectionKind,
      version: s.version,
      format: s.content?.format === "markdown" ? "markdown" : "structured",
      data: s.content?.data ?? null,
      note: s.content?.note ?? null,
      createdAt: s.created_at,
    }));
    return { kit: this.kitFromRow(r), sections };
  }

  async createKit(input: { title: string; nicheSlug: string; subnicheSlug: string | null; referenceIds: string[]; inputs: KitInputs }) {
    const now = new Date().toISOString();
    const res = await this.db
      .from("campaign_kits")
      .insert({ workspace_id: this.ws, kind: "kit", version: 1, content: { ...input, updatedAt: now } })
      .select("*")
      .single();
    return this.kitFromRow(check(res, "criar kit"));
  }

  async updateKit(id: string, patch: Partial<Pick<KitRoot, "title" | "inputs" | "productId" | "referenceIds">>) {
    const cur = await this.getKit(id);
    if (!cur) return;
    const k = { ...cur.kit, ...patch };
    const content = { title: k.title, nicheSlug: k.nicheSlug, subnicheSlug: k.subnicheSlug, referenceIds: k.referenceIds, inputs: k.inputs, updatedAt: new Date().toISOString() };
    check(await this.db.from("campaign_kits").update({ content, product_id: k.productId }).eq("workspace_id", this.ws).eq("id", id), "atualizar kit");
  }

  async saveSection(kitId: string, kind: KitSectionKind, format: KitSection["format"], data: unknown, note: string | null) {
    const { data: prev } = await this.db
      .from("campaign_kits")
      .select("version")
      .eq("workspace_id", this.ws)
      .eq("kind", kind)
      .eq("content->>kit_id", kitId)
      .order("version", { ascending: false })
      .limit(1);
    const version = ((prev?.[0] as any)?.version ?? 0) + 1;
    check(
      await this.db.from("campaign_kits").insert({ workspace_id: this.ws, kind, version, content: { kit_id: kitId, format, data, note } }),
      "salvar seção",
    );
    await this.updateKit(kitId, {});
    return version;
  }

  async deleteKit(id: string) {
    check(await this.db.from("campaign_kits").delete().eq("workspace_id", this.ws).eq("content->>kit_id", id), "excluir seções");
    check(await this.db.from("campaign_kits").delete().eq("workspace_id", this.ws).eq("id", id), "excluir kit");
  }
}
