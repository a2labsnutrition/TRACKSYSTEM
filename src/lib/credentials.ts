import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret, sha256 } from "@/lib/crypto";

export type Provider = "meta" | "meta_capi" | "cakto" | "cakto_api" | "anthropic" | "ad_library" | "google_flow";

/** Salva (ou substitui) uma credencial criptografada do workspace. */
export async function saveCredential(
  db: SupabaseClient,
  workspaceId: string,
  provider: Provider,
  secret: string,
  opts: { meta?: Record<string, unknown>; expiresAt?: string | null; withLookupHash?: boolean } = {},
): Promise<string> {
  const { data, error } = await db
    .from("integration_credentials")
    .upsert(
      {
        workspace_id: workspaceId,
        provider,
        label: "default",
        encrypted_secret: encryptSecret(secret),
        lookup_hash: opts.withLookupHash ? sha256(secret) : null,
        meta: opts.meta ?? {},
        expires_at: opts.expiresAt ?? null,
        status: "active",
        last_error: null,
        last_checked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "workspace_id,provider,label" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`Falha ao salvar credencial: ${error.message}`);
  return data.id as string;
}

export async function readCredential(
  db: SupabaseClient,
  workspaceId: string,
  provider: Provider,
): Promise<{ id: string; secret: string; meta: Record<string, unknown>; expiresAt: string | null; lastError: string | null } | null> {
  const { data } = await db
    .from("integration_credentials")
    .select("id, encrypted_secret, meta, expires_at, last_error")
    .eq("workspace_id", workspaceId)
    .eq("provider", provider)
    .eq("label", "default")
    .maybeSingle();
  if (!data) return null;
  try {
    return { id: data.id, secret: decryptSecret(data.encrypted_secret), meta: data.meta ?? {}, expiresAt: data.expires_at, lastError: data.last_error };
  } catch {
    return null;
  }
}

export async function markCredentialError(db: SupabaseClient, workspaceId: string, provider: Provider, error: string | null) {
  await db
    .from("integration_credentials")
    .update({ last_error: error, last_checked_at: new Date().toISOString() })
    .eq("workspace_id", workspaceId)
    .eq("provider", provider);
}
