import { env } from "@/lib/env";
import { addDays } from "@/lib/tz";

/**
 * Adaptador da API pública da Cakto (opcional — o webhook é a fonte principal).
 *
 * O que foi confirmado na referência pública (docs.cakto.com.br, 10/2026):
 *   - Base: https://api.cakto.com.br/public_api/
 *   - Autenticação: Authorization: Bearer <token>
 *   - Recursos de webhooks (/public_api/webhook/) e de pedidos: GET /public_api/orders/
 *     (escopos "read orders"; filtros createdAt__gte/__lt, ordering, limit/page;
 *     resposta { count, next, previous, results }).
 *   - Token: POST /public_api/token/ com client_id e client_secret (form).
 * NÃO confirmado: todos os nomes de campos de cada pedido (o parser é tolerante).
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
  let json: { access_token?: string; token?: string; scope?: string };
  try {
    json = JSON.parse(text);
  } catch {
    throw new CaktoApiError("Resposta inesperada ao gerar token da Cakto", res.status, text);
  }
  const tok = json.access_token ?? json.token;
  if (!tok) throw new CaktoApiError("Resposta inesperada ao gerar token da Cakto (sem access_token)", res.status, text);
  const missing = missingScopes(json.scope);
  if (missing.length) {
    throw new CaktoApiError(
      `A chave da API da Cakto não tem permissão para consultar pedidos (faltam os escopos: ${missing.join(", ")}). ` +
        "Na Cakto → Integrações → API, crie uma chave nova marcando “Leitura” (read) e “Pedidos” (orders) e cole o client_id e o client_secret novos aqui.",
      403,
      "",
    );
  }
  return tok;
}

/**
 * Escopos que a conciliação precisa (GET /public_api/orders/ exige "read orders").
 * Sem o campo `scope` na resposta, não dá para saber: deixa passar.
 */
export function missingScopes(scope: string | null | undefined): string[] {
  if (typeof scope !== "string" || !scope.trim()) return [];
  const have = new Set(scope.toLowerCase().split(/\s+/));
  return ["read", "orders"].filter((s) => !have.has(s));
}

/**
 * Próxima página: a Cakto devolve `next` como URL absoluta, que pode vir com
 * http:// (o redirecionamento para https descarta o token → 401). Mantém só
 * caminho + parâmetros e usa a base configurada (https).
 */
export function nextPageUrl(next: unknown, base: string): string | null {
  if (typeof next !== "string" || !next) return null;
  try {
    const u = new URL(next, base);
    if (!u.pathname.startsWith("/public_api/")) return null;
    return `${base}${u.pathname}${u.search}`;
  } catch {
    return null;
  }
}

/** Lista pedidos (todas as páginas até `maxPages`). Retorna objetos crus. */
export async function caktoListOrders(
  token: string,
  params: { createdFrom?: string; createdTo?: string; maxPages?: number } = {},
  fetchImpl: typeof fetch = fetch,
): Promise<unknown[]> {
  const out: unknown[] = [];
  // Filtros da documentação (docs.cakto.com.br/api-reference/orders/list): createdAt__gte / createdAt__lt.
  // "Até hoje" vira "antes de amanhã": a data sozinha vale como meia-noite e cortaria os pedidos de hoje.
  let url: string | null = `${env.caktoApiBase}${ORDERS_PATH}?${new URLSearchParams({
    ...(params.createdFrom ? { createdAt__gte: params.createdFrom } : {}),
    ...(params.createdTo ? { createdAt__lt: addDays(params.createdTo, 1) } : {}),
    ordering: "-createdAt",
    limit: "100",
  }).toString()}`;
  let pages = 0;
  while (url && pages++ < (params.maxPages ?? 20)) {
    const res: Response = await fetchImpl(url, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      redirect: "manual",
      cache: "no-store",
    });
    const text = await res.text();
    if (!res.ok) {
      const why =
        res.status === 401
          ? "a Cakto não aceitou o token. Confira se a chave tem os escopos “Leitura” (read) e “Pedidos” (orders); se tiver, gere uma chave nova e cole de novo em Conexões"
          : res.status === 403
            ? "a chave não tem permissão para consultar pedidos (escopos read e orders)"
            : res.status >= 300 && res.status < 400
              ? "a Cakto redirecionou a consulta (ajuste CAKTO_API_BASE para https://api.cakto.com.br)"
              : "erro na Cakto, tente de novo em alguns minutos";
      throw new CaktoApiError(`Falha ao listar pedidos da Cakto (HTTP ${res.status}): ${why}.`, res.status, text);
    }
    const json = JSON.parse(text) as Record<string, unknown>;
    const list = (json.results ?? json.data ?? json.items ?? json.orders ?? (Array.isArray(json) ? json : [])) as unknown[];
    out.push(...list);
    url = nextPageUrl(json.next ?? (json.links as Record<string, unknown> | undefined)?.next, env.caktoApiBase);
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
