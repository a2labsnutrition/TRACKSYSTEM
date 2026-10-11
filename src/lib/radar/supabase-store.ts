import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AiSubniche } from "./catalog";
import type { HookStatus, NewHook, RadarHook } from "./hooks";
import type { RadarSnapshot } from "./measure";
import { HISTORY_DAYS, type RadarStore } from "./store";

/* eslint-disable @typescript-eslint/no-explicit-any */

const K = { snapshot: "radar_ia_medicao", hook: "radar_ia_gancho", custom: "radar_ia_subnicho" } as const;

function check<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

const STATUSES: HookStatus[] = ["novo", "enviado", "descartado"];

function hookFromRow(r: any): RadarHook {
  const c = r.content ?? {};
  return {
    id: r.id,
    slug: String(c.slug ?? ""),
    text: String(c.text ?? ""),
    source: c.source === "youtube" || c.source === "ia" ? c.source : "manual",
    reference: typeof c.reference === "string" ? c.reference : null,
    status: STATUSES.includes(c.status) ? c.status : "novo",
    createdAt: r.created_at,
    sentAt: typeof c.sentAt === "string" ? c.sentAt : null,
  };
}

/** Implementação real em `campaign_kits` (RLS do usuário logado ou service role no cron). */
export class SupabaseRadarStore implements RadarStore {
  readonly mode = "live" as const;
  constructor(
    private db: SupabaseClient,
    private ws: string,
  ) {}

  async listSnapshots(limit = HISTORY_DAYS) {
    const res = await this.db
      .from("campaign_kits")
      .select("content, created_at")
      .eq("workspace_id", this.ws)
      .eq("kind", K.snapshot)
      .order("created_at", { ascending: false })
      .limit(limit * 2);
    const byDate = new Map<string, RadarSnapshot>();
    for (const r of (check(res, "ler histórico do radar") ?? []) as any[]) {
      const s = r.content as RadarSnapshot | null;
      if (!s?.date || !Array.isArray(s.items) || byDate.has(s.date)) continue;
      byDate.set(s.date, s);
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-limit);
  }

  async saveSnapshot(s: RadarSnapshot) {
    check(await this.db.from("campaign_kits").delete().eq("workspace_id", this.ws).eq("kind", K.snapshot).eq("content->>date", s.date), "substituir medição do dia");
    check(await this.db.from("campaign_kits").insert({ workspace_id: this.ws, kind: K.snapshot, version: 1, content: s }), "salvar medição do radar");
  }

  async listHooks() {
    const res = await this.db.from("campaign_kits").select("id, content, created_at").eq("workspace_id", this.ws).eq("kind", K.hook).order("created_at", { ascending: false }).limit(1000);
    return ((check(res, "ler ganchos") ?? []) as any[]).map(hookFromRow).filter((h) => h.slug && h.text);
  }

  async addHooks(items: NewHook[]) {
    if (!items.length) return 0;
    const rows = items.map((i) => ({ workspace_id: this.ws, kind: K.hook, version: 1, content: { slug: i.slug, text: i.text, source: i.source, reference: i.reference, status: "novo", sentAt: null } }));
    check(await this.db.from("campaign_kits").insert(rows), "salvar ganchos");
    return rows.length;
  }

  async setHookStatus(id: string, status: HookStatus) {
    const res = await this.db.from("campaign_kits").select("id, content, created_at").eq("workspace_id", this.ws).eq("kind", K.hook).eq("id", id).maybeSingle();
    const r = check(res, "ler gancho") as any;
    if (!r) return null;
    const content = { ...(r.content ?? {}), status, ...(status === "enviado" ? { sentAt: new Date().toISOString() } : {}) };
    check(await this.db.from("campaign_kits").update({ content }).eq("workspace_id", this.ws).eq("id", id), "atualizar gancho");
    return hookFromRow({ ...r, content });
  }

  async deleteHook(id: string) {
    check(await this.db.from("campaign_kits").delete().eq("workspace_id", this.ws).eq("kind", K.hook).eq("id", id), "remover gancho");
  }

  async listCustom() {
    const res = await this.db.from("campaign_kits").select("content").eq("workspace_id", this.ws).eq("kind", K.custom).order("created_at", { ascending: true });
    return ((check(res, "ler subnichos") ?? []) as any[]).map((r) => r.content as AiSubniche).filter((s) => s?.slug && s?.query);
  }

  async addCustom(s: AiSubniche) {
    await this.deleteCustom(s.slug);
    check(await this.db.from("campaign_kits").insert({ workspace_id: this.ws, kind: K.custom, version: 1, content: s }), "salvar subnicho");
  }

  async deleteCustom(slug: string) {
    check(await this.db.from("campaign_kits").delete().eq("workspace_id", this.ws).eq("kind", K.custom).eq("content->>slug", slug), "remover subnicho");
  }
}
