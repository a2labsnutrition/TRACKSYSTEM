/**
 * Acesso centralizado a variáveis de ambiente.
 * Nada aqui deve ser importado por componentes client, exceto as NEXT_PUBLIC_*.
 */

export const env = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  defaultTimezone: process.env.DEFAULT_TIMEZONE ?? "America/Cuiaba",

  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
  supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
  supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",

  encryptionKey: process.env.ENCRYPTION_KEY ?? "",
  cronSecret: process.env.CRON_SECRET ?? "",

  metaAppId: process.env.META_APP_ID ?? "",
  metaAppSecret: process.env.META_APP_SECRET ?? "",
  metaGraphVersion: process.env.META_GRAPH_VERSION ?? "v26.0",
  metaHistoryDays: Number(process.env.META_HISTORY_DAYS ?? 90),

  caktoApiBase: process.env.CAKTO_API_BASE ?? "https://api.cakto.com.br",

  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicModel: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",

  chromiumPath: process.env.CHROMIUM_PATH ?? "",
};

export function isSupabaseConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseAnonKey);
}

export function isServiceRoleConfigured(): boolean {
  return Boolean(env.supabaseUrl && env.supabaseServiceRoleKey);
}

export function isMetaAppConfigured(): boolean {
  return Boolean(env.metaAppId && env.metaAppSecret);
}
