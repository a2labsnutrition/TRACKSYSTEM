import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * Cliente com service role: IGNORA RLS. Usar só em rotas de servidor que não
 * têm usuário (webhooks, coleta do script, cron) ou depois de checar o membro.
 */
let admin: SupabaseClient | null = null;
export function supabaseAdmin(): SupabaseClient {
  if (!env.supabaseUrl || !env.supabaseServiceRoleKey) {
    throw new Error("Supabase service role não configurada (SUPABASE_SERVICE_ROLE_KEY)");
  }
  admin ??= createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}
