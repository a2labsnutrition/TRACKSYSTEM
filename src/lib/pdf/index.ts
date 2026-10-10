import "server-only";
import { getRepository } from "@/lib/data";
import type { Repository } from "@/lib/data/repository";
import type { Workspace } from "@/lib/data/types";
import { createSupabaseServer } from "@/lib/supabase/server";
import { MemoryPdfStore, type PdfStore } from "./store";
import { SupabasePdfStore } from "./supabase-store";

const g = globalThis as unknown as { __ccPdfDemo?: MemoryPdfStore };

export async function getPdfStore(): Promise<{ store: PdfStore; repo: Repository; workspace: Workspace; mode: "demo" | "live" }> {
  const repo = await getRepository();
  const ctx = await repo.context();
  if (ctx.mode === "demo") {
    g.__ccPdfDemo ??= new MemoryPdfStore();
    return { store: g.__ccPdfDemo, repo, workspace: ctx.workspace, mode: "demo" };
  }
  return { store: new SupabasePdfStore(await createSupabaseServer(), ctx.workspace.id), repo, workspace: ctx.workspace, mode: "live" };
}
