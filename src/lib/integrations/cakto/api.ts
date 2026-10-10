import { env } from "@/lib/env";

/**
 * Adaptador da API pública da Cakto (opcional — o webhook é a fonte principal).
 *
 * O que foi confirmado na referência pública (docs.cakto.com.br, 10/2026):
 *   - Base: https://api.cakto.com.br/public_api/
 *   - Autenticação: Authorization: Bearer <token>
 *   - Recursos de webhooks (/public_api/webhook/) e de pedidos (orders/list).
 *   - Token: POST /public_api/token/ com client_id e client_secret (form).
 * NÃO confirmado: os nomes dos campos/paginação da listagem de pedidos.
 * Por isso: endpoints configuráveis, parser tolerante e erros explicativos.
 * Para ajustar, edite só este arquivo.
 */

export interface CaktoApiCredentials {
  clientId: string;
  clientSecret: string;
}

const TOKEN_PATH = process.env.CAKTO_TOKEN_PATH ?? "/public_api/token/";
const ORDERS_PATH = process.env.CAKTO_ORDERS_PATH ?? "/public_api/orders/";

export class CaktoApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: string,
  ) {
    super(message);
  }
}

/** Trecho da resposta de erro da Cakto, sem as credenciais (para mostrar na tela). */
function errorHint(text: string, c: CaktoApiCredentials): string {
  let t = text.replace(/\s+/g, " ").trim();
  for (const secret of [c.clientSecret, c.clientId]) if (secret) t = t.split(secret).join("***");
  if (/<html/i.test(t)) return "";
  return t ? ` Resposta: ${t.slice(0, 200)}` : "";
}

/**
 * Token: POST /public_api/token/ com client_id e client_secret em form
 * (formato da documentação oficial: docs.cakto.com.br/authentication).
 */
export async function caktoToken(c: CaktoApiCredentials, fetchImpl: typeof fetch = fetch): Promise<string> {
  const res = await fetchImpl(`${env.caktoApiBase}${TOKEN_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret }).toString(),
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) {
    const why =
      res.status === 404
        ? "endereço do token não encontrado (ajuste CAKTO_TOKEN_PATH)"
        : res.status === 400 || res.status === 401 || res.status === 403
          ? "credenciais recusadas — gere uma chave nova em Cakto → Integrações → API e cole client_id e client_secret sem espaços"
          : "erro no servidor da Cakto, tente de novo em alguns minutos";
    throw new CaktoApiError(`Cakto recusou o pedido de token (HTTP ${res.status}): ${why}.${errorHint(text, c)}`, res.status, text);
  }
  try {
    const json = JSON.parse(text) as { access_token?: string; token?: string };
    const tok = json.access_token ?? json.token;
    if (!tok) throw new Error("sem access_token");
    return tok;
  } catch {
    throw new CaktoApiError("Resposta inesperada ao gerar token da Cakto", res.status, text);
  }
}

/** Lista pedidos (todas as páginas até `maxPages`). Retorna objetos crus. */
export async function caktoListOrders(
  token: string,
  params: { createdFrom?: string; createdTo?: string; maxPages?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<unknown[]> {
  const out: unknown[] = [];
  let url: string | null = `${env.caktoApiBase}${ORDERS_PATH}?${new URLSearchParams({
    ...(params.createdFrom ? { created_at__gte: params.createdFrom, createdAt__gte: params.createdFrom } : {}),
    ...(params.createdTo ? { created_at__lte: params.createdTo, createdAt__lte: params.createdTo } : {}),
    limit: "100",
  }).toString()}`;
  let pages = 0;
  while (url && pages++ < (params.maxPages ?? 20)) {
    const res: Response = await fetchImpl(url, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    const text = await res.text();
    if (!res.ok) throw new CaktoApiError(`Falha ao listar pedidos da Cakto (HTTP ${res.status})`, res.status, text);
    const json = JSON.parse(text) as Record<string, unknown>;
    const list = (json.results ?? json.data ?? json.items ?? json.orders ?? (Array.isArray(json) ? json : [])) as unknown[];
    out.push(...list);
    const next = (json.next ?? (json.links as Record<string, unknown> | undefined)?.next ?? null) as string | null;
    url = next && typeof next === "string" ? next : null;
  }
  return out;
}

/** Converte um pedido da API para o formato de webhook, para reutilizar o mesmo parser/idempotência. */
export function orderToWebhookBody(order: Record<string, unknown>): { event: string; data: Record<string, unknown> } {
  const status = String(order.status ?? "").toLowerCase();
  const event =
    status === "paid" || status === "approved" || status === "authorized"
      ? "purchase_approved"
      : status === "refunded"
        ? "refund"
        : status === "chargedback" || status === "chargeback"
          ? "chargeback"
          : status === "refused" || status === "declined"
            ? "purchase_refused"
            : String(order.paymentMethod ?? order.payment_method ?? "").includes("boleto")
              ? "boleto_gerado"
              : "pix_gerado";
  return { event, data: order };
}
