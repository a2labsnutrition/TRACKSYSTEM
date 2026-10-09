import { env } from "@/lib/env";
import { graphGetAll, graphRequest, graphUrl } from "./client";

/**
 * Login com Facebook (OAuth) e troca por token de longa duração (~60 dias).
 * Alternativa recomendada para produção: token de Usuário do Sistema
 * (Business Manager), que não expira — colado manualmente em Conexões.
 */

export const META_SCOPES = ["ads_read", "ads_management", "business_management"];

export function oauthDialogUrl(state: string, redirectUri: string): string {
  const url = new URL(`https://www.facebook.com/${env.metaGraphVersion}/dialog/oauth`);
  url.searchParams.set("client_id", env.metaAppId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", META_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  return url.toString();
}

export async function exchangeCodeForToken(code: string, redirectUri: string) {
  const url = graphUrl("oauth/access_token", {
    client_id: env.metaAppId,
    client_secret: env.metaAppSecret,
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json()) as { access_token?: string; error?: { message: string } };
  if (!json.access_token) throw new Error(json.error?.message ?? "Falha ao trocar o código pelo token");
  return json.access_token;
}

export async function exchangeForLongLived(shortToken: string) {
  const url = graphUrl("oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: env.metaAppId,
    client_secret: env.metaAppSecret,
    fb_exchange_token: shortToken,
  });
  const res = await fetch(url, { cache: "no-store" });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error?: { message: string } };
  if (!json.access_token) throw new Error(json.error?.message ?? "Falha ao gerar token de longa duração");
  return {
    token: json.access_token,
    expiresAt: json.expires_in ? new Date(Date.now() + json.expires_in * 1000).toISOString() : null,
  };
}

export interface TokenInfo {
  isValid: boolean;
  expiresAt: string | null;
  scopes: string[];
  type: string | null;
  userId: string | null;
}

/** /debug_token — exige app token (app_id|app_secret). */
export async function debugToken(token: string): Promise<TokenInfo> {
  const appToken = `${env.metaAppId}|${env.metaAppSecret}`;
  const json = await graphRequest<{
    data?: { is_valid?: boolean; expires_at?: number; scopes?: string[]; type?: string; user_id?: string };
  }>("GET", "debug_token", { input_token: token }, { accessToken: appToken });
  const d = json.data ?? {};
  return {
    isValid: Boolean(d.is_valid),
    expiresAt: d.expires_at ? new Date(d.expires_at * 1000).toISOString() : null, // 0 = nunca expira
    scopes: d.scopes ?? [],
    type: d.type ?? null,
    userId: d.user_id ?? null,
  };
}

export interface MetaAdAccountInfo {
  id: string; // act_...
  account_id: string;
  name: string;
  currency: string;
  timezone_name: string;
  account_status: number;
}

export async function listAdAccounts(token: string): Promise<MetaAdAccountInfo[]> {
  return graphGetAll<MetaAdAccountInfo>(
    "me/adaccounts",
    { fields: "id,account_id,name,currency,timezone_name,account_status", limit: 100 },
    { accessToken: token },
  );
}

export async function listPixels(token: string, actId: string): Promise<Array<{ id: string; name: string; last_fired_time?: string }>> {
  return graphGetAll(`${actId}/adspixels`, { fields: "id,name,last_fired_time", limit: 100 }, { accessToken: token });
}

export const ACCOUNT_STATUS: Record<number, string> = {
  1: "Ativa",
  2: "Desativada",
  3: "Pagamento pendente",
  7: "Em análise de risco",
  8: "Pendente de liquidação",
  9: "Em período de carência",
  100: "Pendente de encerramento",
  101: "Encerrada",
};
