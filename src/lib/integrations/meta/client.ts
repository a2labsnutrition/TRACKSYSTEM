import { env } from "@/lib/env";

/**
 * Cliente mínimo da Graph/Marketing API do Meta com:
 *  - paginação (paging.next)
 *  - retry com backoff exponencial em limites de taxa e erros transitórios
 *  - leitura do header x-business-use-case-usage para respeitar o tempo de espera
 *
 * Códigos de limite documentados: 4, 17, 32, 613, 80000–80014 (Business Use Case).
 */

export class MetaApiError extends Error {
  constructor(
    message: string,
    public code: number | null,
    public subcode: number | null,
    public httpStatus: number,
    public fbtraceId: string | null,
    public raw: unknown,
  ) {
    super(message);
    this.name = "MetaApiError";
  }

  get isRateLimit(): boolean {
    const c = this.code ?? 0;
    return c === 4 || c === 17 || c === 32 || c === 613 || (c >= 80000 && c <= 80014);
  }

  get isTokenInvalid(): boolean {
    return this.code === 190 || this.code === 102;
  }

  get isTransient(): boolean {
    return this.isRateLimit || this.code === 1 || this.code === 2 || this.httpStatus >= 500;
  }

  /** Mensagem em português com a correção provável. */
  get friendly(): string {
    if (this.isTokenInvalid) return "Token do Meta expirado ou revogado. Reconecte a conta em Conexões → Meta.";
    if (this.code === 10 || this.code === 200 || this.code === 294)
      return "Permissão insuficiente no app/token do Meta (verifique ads_read e acesso à conta de anúncios).";
    if (this.code === 100) return `Parâmetro inválido na API do Meta: ${this.message}`;
    if (this.isRateLimit) return "Limite de requisições do Meta atingido. O sistema vai tentar de novo automaticamente.";
    return `Erro da API do Meta: ${this.message}`;
  }
}

export interface GraphOptions {
  accessToken: string;
  version?: string;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function graphUrl(path: string, params: Record<string, string | number | undefined> = {}, version = env.metaGraphVersion) {
  const url = new URL(path.startsWith("http") ? path : `https://graph.facebook.com/${version}/${path.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, String(v));
  return url;
}

function waitFromUsageHeader(h: Headers): number | null {
  const raw = h.get("x-business-use-case-usage");
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, Array<{ estimated_time_to_regain_access?: number }>>;
    let max = 0;
    for (const arr of Object.values(parsed)) for (const u of arr) max = Math.max(max, u.estimated_time_to_regain_access ?? 0);
    return max > 0 ? max * 60_000 : null; // minutos
  } catch {
    return null;
  }
}

export async function graphRequest<T = unknown>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  params: Record<string, string | number | undefined>,
  opts: GraphOptions,
  body?: unknown,
): Promise<T> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? defaultSleep;
  const maxRetries = opts.maxRetries ?? 4;
  const url = graphUrl(path, { ...params, access_token: opts.accessToken }, opts.version);

  let attempt = 0;
  while (true) {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
    } catch (e) {
      if (attempt < maxRetries) {
        await sleep(backoff(attempt++));
        continue;
      }
      throw new MetaApiError(`Falha de rede: ${(e as Error).message}`, null, null, 0, null, null);
    }

    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    const errObj = (json as { error?: { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string } } | null)?.error;
    if (!res.ok || errObj) {
      const err = new MetaApiError(
        errObj?.message ?? `HTTP ${res.status}`,
        errObj?.code ?? null,
        errObj?.error_subcode ?? null,
        res.status,
        errObj?.fbtrace_id ?? null,
        json,
      );
      if (err.isTransient && attempt < maxRetries) {
        const headerWait = waitFromUsageHeader(res.headers);
        // Se o Meta pede uma espera longa (> 2 min), devolve para a fila em vez de bloquear a função.
        if (headerWait && headerWait > 120_000) throw err;
        await sleep(headerWait ?? backoff(attempt));
        attempt++;
        continue;
      }
      throw err;
    }
    return json as T;
  }
}

export function backoff(attempt: number): number {
  const base = 2000 * 2 ** attempt; // 2s, 4s, 8s, 16s
  return base + Math.floor(Math.random() * 500);
}

export async function graphGetAll<T>(
  path: string,
  params: Record<string, string | number | undefined>,
  opts: GraphOptions,
  maxPages = 50,
): Promise<T[]> {
  const out: T[] = [];
  let page = await graphRequest<{ data?: T[]; paging?: { next?: string } }>("GET", path, params, opts);
  out.push(...(page.data ?? []));
  let n = 1;
  while (page.paging?.next && n < maxPages) {
    // paging.next já contém access_token e parâmetros
    const next = new URL(page.paging.next);
    const p: Record<string, string> = {};
    next.searchParams.forEach((v, k) => {
      if (k !== "access_token") p[k] = v;
    });
    page = await graphRequest("GET", next.origin + next.pathname, p, opts);
    out.push(...(page.data ?? []));
    n++;
  }
  return out;
}
