import type { CreativeAsset, FlowQueueItem, FlowScene, QueueStatus } from "./flow";

/**
 * Fila do Flow e biblioteca de criativos. Usa as tabelas que já existem
 * (flow_queue, creative_assets) — sem migração: os detalhes da cena vão como
 * JSON na coluna `prompt` da fila (texto puro antigo também é aceito).
 */
export interface CreativeStore {
  readonly mode: "demo" | "live";
  listQueue(): Promise<FlowQueueItem[]>;
  addQueueItems(items: Array<FlowScene & { kitId: string | null; priority: number; scheduledFor: string; status: QueueStatus }>): Promise<number>;
  updateQueueItem(id: string, patch: Partial<Pick<FlowQueueItem, "status" | "scheduledFor" | "assetId" | "priority">>): Promise<void>;
  deleteQueueItem(id: string): Promise<void>;
  listAssets(): Promise<CreativeAsset[]>;
  addAsset(a: Omit<CreativeAsset, "id" | "createdAt">): Promise<CreativeAsset>;
  updateAsset(id: string, patch: Partial<Pick<CreativeAsset, "adName" | "angle" | "hook" | "metaAdId">>): Promise<void>;
  deleteAsset(id: string): Promise<CreativeAsset | null>;
}

export function encodeScene(s: FlowScene): string {
  return JSON.stringify({ v: 1, title: s.title, angle: s.angle, prompt: s.prompt, ratio: s.ratio, durationS: s.durationS, variant: s.variant, hook: s.hook });
}

export function decodeScene(raw: string): FlowScene {
  try {
    const o = JSON.parse(raw) as Partial<FlowScene> & { v?: number };
    if (o && o.v === 1 && typeof o.prompt === "string") {
      return {
        title: String(o.title ?? "Cena"),
        angle: String(o.angle ?? "geral"),
        prompt: o.prompt,
        ratio: String(o.ratio ?? "9:16"),
        durationS: typeof o.durationS === "number" ? o.durationS : null,
        variant: o.variant === "B" ? "B" : "A",
        hook: typeof o.hook === "string" ? o.hook : null,
      };
    }
  } catch {
    // texto puro
  }
  return { title: raw.slice(0, 40), angle: "geral", prompt: raw, ratio: "9:16", durationS: null, variant: "A", hook: null };
}

const uid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export class MemoryCreativeStore implements CreativeStore {
  readonly mode = "demo" as const;
  queue: FlowQueueItem[] = [];
  assets: CreativeAsset[] = [];

  async listQueue() {
    return [...this.queue].sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt));
  }
  async addQueueItems(items: Parameters<CreativeStore["addQueueItems"]>[0]) {
    const now = new Date().toISOString();
    for (const i of items) this.queue.push({ ...i, id: uid(), assetId: null, createdAt: now });
    return items.length;
  }
  async updateQueueItem(id: string, patch: Parameters<CreativeStore["updateQueueItem"]>[1]) {
    const q = this.queue.find((x) => x.id === id);
    if (q) Object.assign(q, patch);
  }
  async deleteQueueItem(id: string) {
    this.queue = this.queue.filter((x) => x.id !== id);
  }
  async listAssets() {
    return [...this.assets].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async addAsset(a: Omit<CreativeAsset, "id" | "createdAt">) {
    const asset: CreativeAsset = { ...a, id: uid(), createdAt: new Date().toISOString() };
    this.assets.push(asset);
    return asset;
  }
  async updateAsset(id: string, patch: Parameters<CreativeStore["updateAsset"]>[1]) {
    const a = this.assets.find((x) => x.id === id);
    if (a) Object.assign(a, patch);
  }
  async deleteAsset(id: string) {
    const a = this.assets.find((x) => x.id === id) ?? null;
    this.assets = this.assets.filter((x) => x.id !== id);
    for (const q of this.queue) if (q.assetId === id) q.assetId = null;
    return a;
  }
}
