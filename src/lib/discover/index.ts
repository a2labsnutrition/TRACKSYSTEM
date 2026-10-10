import "server-only";
import { getRepository } from "@/lib/data";
import { createSupabaseServer } from "@/lib/supabase/server";
import { todayIn } from "@/lib/tz";
import { seedDemoStore } from "./demo";
import { MemoryDiscoverStore, type DiscoverStore } from "./store";
import { SupabaseDiscoverStore } from "./supabase-store";

const g = globalThis as unknown as { __ccDiscoverDemo?: MemoryDiscoverStore };

/** Armazenamento do Descobrir & Criar da requisição (real ou demo). */
export async function getDiscoverStore(): Promise<{ store: DiscoverStore; workspaceId: string; mode: "demo" | "live" }> {
  const repo = await getRepository();
  const ctx = await repo.context();
  if (ctx.mode === "demo") {
    if (!g.__ccDiscoverDemo) {
      g.__ccDiscoverDemo = new MemoryDiscoverStore();
      seedDemoStore(g.__ccDiscoverDemo, todayIn(ctx.workspace.timezone));
    }
    return { store: g.__ccDiscoverDemo, workspaceId: ctx.workspace.id, mode: "demo" };
  }
  return { store: new SupabaseDiscoverStore(await createSupabaseServer(), ctx.workspace.id), workspaceId: ctx.workspace.id, mode: "live" };
}
