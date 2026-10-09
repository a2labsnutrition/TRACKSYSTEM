import "server-only";
import { sha256 } from "@/lib/crypto";
import { isServiceRoleConfigured } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { getMemoryStore } from "./memory-store";
import type { IngestStore } from "./store";
import { SupabaseIngestStore } from "./supabase-store";

export const DEMO_WORKSPACE_ID = "demo";
export const DEMO_SITE_KEY = "demo_site";
export const DEMO_CAKTO_SECRET = "demo-secret";

/**
 * Store de ingestão: Supabase quando configurado; senão memória (modo demo
 * local), já com um site e um segredo da Cakto de demonstração.
 */
export function getIngestStore(): IngestStore {
  if (isServiceRoleConfigured()) return new SupabaseIngestStore(supabaseAdmin());
  const mem = getMemoryStore();
  if (!mem.sites.has(DEMO_SITE_KEY)) {
    mem.sites.set(DEMO_SITE_KEY, {
      workspaceId: DEMO_WORKSPACE_ID,
      site: {
        id: "demo-site",
        publicKey: DEMO_SITE_KEY,
        name: "Página de demonstração",
        domain: null,
        pixelId: null,
        checkoutSelectors: [],
        idParam: "sck",
        consentMode: "none",
        createdAt: new Date().toISOString(),
      },
    });
    mem.cakto.set(DEMO_WORKSPACE_ID, { secret: DEMO_CAKTO_SECRET, secretHash: sha256(DEMO_CAKTO_SECRET) });
  }
  return mem;
}
