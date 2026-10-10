import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CreativeAsset, FlowQueueItem, QueueStatus } from "./flow";
import { decodeScene, encodeScene, type CreativeStore } from "./store";

/* eslint-disable @typescript-eslint/no-explicit-any */

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

const STATUSES: QueueStatus[] = ["backlog", "todo", "done", "skipped"];

function queueFromRow(r: any): FlowQueueItem {
  return {
    ...decodeScene(String(r.prompt ?? "")),
    id: r.id,
    kitId: r.kit_id ?? null,
    priority: r.priority ?? 0,
    scheduledFor: String(r.scheduled_for ?? "").slice(0, 10),
    status: STATUSES.includes(r.status) ? r.status : "backlog",
    assetId: r.asset_id ?? null,
    createdAt: r.created_at,
  };
}

function assetFromRow(r: any): CreativeAsset {
  return {
    id: r.id,
    kitId: r.kit_id ?? null,
    storagePath: r.storage_path,
    adName: r.ad_name ?? null,
    angle: r.angle ?? null,
    hook: r.hook ?? null,
    metaAdId: r.meta_ad_id ?? null,
    createdAt: r.created_at,
  };
}

export class SupabaseCreativeStore implements CreativeStore {
  readonly mode = "live" as const;
  constructor(
    private db: SupabaseClient,
    private ws: string,
  ) {}

  async listQueue() {
    const res = await this.db
      .from("flow_queue")
      .select("*")
      .eq("workspace_id", this.ws)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(1000);
    return (check(res, "ler fila do Flow") ?? []).map(queueFromRow);
  }

  async addQueueItems(items: Parameters<CreativeStore["addQueueItems"]>[0]) {
    if (!items.length) return 0;
    const rows = items.map((i) => ({
      workspace_id: this.ws,
      kit_id: i.kitId,
      prompt: encodeScene(i),
      priority: i.priority,
      scheduled_for: i.scheduledFor,
      status: i.status,
    }));
    check(await this.db.from("flow_queue").insert(rows), "adicionar à fila");
    return rows.length;
  }

  async updateQueueItem(id: string, patch: Parameters<CreativeStore["updateQueueItem"]>[1]) {
    const row: Record<string, unknown> = {};
    if (patch.status) row.status = patch.status;
    if (patch.scheduledFor) row.scheduled_for = patch.scheduledFor;
    if (patch.assetId !== undefined) row.asset_id = patch.assetId;
    if (patch.priority !== undefined) row.priority = patch.priority;
    check(await this.db.from("flow_queue").update(row).eq("workspace_id", this.ws).eq("id", id), "atualizar item da fila");
  }

  async deleteQueueItem(id: string) {
    check(await this.db.from("flow_queue").delete().eq("workspace_id", this.ws).eq("id", id), "remover item da fila");
  }

  async listAssets() {
    const res = await this.db.from("creative_assets").select("*").eq("workspace_id", this.ws).order("created_at", { ascending: false }).limit(500);
    return (check(res, "ler criativos") ?? []).map(assetFromRow);
  }

  async addAsset(a: Omit<CreativeAsset, "id" | "createdAt">) {
    const res = await this.db
      .from("creative_assets")
      .insert({ workspace_id: this.ws, kit_id: a.kitId, storage_path: a.storagePath, ad_name: a.adName, angle: a.angle, hook: a.hook, meta_ad_id: a.metaAdId })
      .select("*")
      .single();
    return assetFromRow(check(res, "salvar criativo"));
  }

  async updateAsset(id: string, patch: Parameters<CreativeStore["updateAsset"]>[1]) {
    const row: Record<string, unknown> = {};
    if (patch.adName !== undefined) row.ad_name = patch.adName;
    if (patch.angle !== undefined) row.angle = patch.angle;
    if (patch.hook !== undefined) row.hook = patch.hook;
    if (patch.metaAdId !== undefined) row.meta_ad_id = patch.metaAdId;
    check(await this.db.from("creative_assets").update(row).eq("workspace_id", this.ws).eq("id", id), "atualizar criativo");
  }

  async deleteAsset(id: string) {
    const res = await this.db.from("creative_assets").delete().eq("workspace_id", this.ws).eq("id", id).select("*").maybeSingle();
    const r = check(res, "remover criativo");
    return r ? assetFromRow(r) : null;
  }

  // Análises ficam em campaign_kits (kind "analise_criativos", com campaign_id) — tabela já existente.
  async getAnalysis(campaignId: string) {
    const res = await this.db
      .from("campaign_kits")
      .select("content, created_at")
      .eq("workspace_id", this.ws)
      .eq("kind", "analise_criativos")
      .eq("campaign_id", campaignId)
      .order("created_at", { ascending: false })
      .limit(1);
    const r = (check(res, "ler análise") ?? [])[0] as any;
    return r ? { data: r.content, createdAt: r.created_at } : null;
  }

  async saveAnalysis(campaignId: string, data: unknown) {
    check(await this.db.from("campaign_kits").insert({ workspace_id: this.ws, kind: "analise_criativos", campaign_id: campaignId, version: 1, content: data }), "salvar análise");
  }
}
