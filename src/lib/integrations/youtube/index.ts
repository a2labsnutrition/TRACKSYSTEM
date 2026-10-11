/**
 * YouTube Data API v3 (oficial): só leitura de dados públicos, para medir o
 * interesse do público em um tema. Endpoints usados:
 *  - GET /youtube/v3/search  (type=video, regionCode, relevanceLanguage, publishedAfter, order=viewCount, maxResults ≤ 50)
 *  - GET /youtube/v3/videos  (part=snippet,statistics; até 50 ids por chamada)
 * A chave fica em YOUTUBE_API_KEY (Vercel) e nunca aparece em log ou tela.
 */

const BASE = "https://www.googleapis.com/youtube/v3";

export interface YtVideo {
  id: string;
  title: string;
  channelId: string;
  channelTitle: string;
  publishedAt: string;
  views: number;
}

export class YoutubeError extends Error {}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const int = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : 0;
};

/** Ids dos vídeos de uma resposta do search.list (ignora itens sem videoId). */
export function parseSearch(json: unknown): string[] {
  const items = (json as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  const ids = items.map((i) => str((i as { id?: { videoId?: unknown } })?.id?.videoId)).filter(Boolean);
  return [...new Set(ids)];
}

/** Vídeos de uma resposta do videos.list (campos ausentes viram vazio/0). */
export function parseVideos(json: unknown): YtVideo[] {
  const items = (json as { items?: unknown[] })?.items;
  if (!Array.isArray(items)) return [];
  return items
    .map((raw) => {
      const i = raw as { id?: unknown; snippet?: Record<string, unknown>; statistics?: Record<string, unknown> };
      return {
        id: str(i.id),
        title: str(i.snippet?.title),
        channelId: str(i.snippet?.channelId),
        channelTitle: str(i.snippet?.channelTitle),
        publishedAt: str(i.snippet?.publishedAt),
        views: int(i.statistics?.viewCount),
      };
    })
    .filter((v) => v.id && v.publishedAt);
}

async function get(path: string, params: Record<string, string>, key: string, fetchImpl: typeof fetch): Promise<unknown> {
  const qs = new URLSearchParams({ ...params, key });
  const res = await fetchImpl(`${BASE}/${path}?${qs.toString()}`, { headers: { accept: "application/json" }, cache: "no-store" });
  const json = (await res.json().catch(() => null)) as { error?: { message?: string; errors?: Array<{ reason?: string }> } } | null;
  if (!res.ok) {
    const reason = json?.error?.errors?.[0]?.reason ?? "";
    if (res.status === 403 && /quota/i.test(reason)) throw new YoutubeError("Cota diária da API do YouTube esgotada. Tente amanhã.");
    if (res.status === 400 || res.status === 403) throw new YoutubeError(`O YouTube recusou a chave ou a consulta (${reason || res.status}). Confira a YOUTUBE_API_KEY e se a "YouTube Data API v3" está ativada no Google Cloud.`);
    throw new YoutubeError(`YouTube respondeu ${res.status}.`);
  }
  return json;
}

/**
 * Vídeos em português (Brasil) mais vistos sobre `query` publicados a partir
 * de `publishedAfter` (ISO). 2 chamadas: busca + estatísticas.
 */
export async function recentTopVideos(
  query: string,
  publishedAfter: string,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<YtVideo[]> {
  if (!key) throw new YoutubeError("YOUTUBE_API_KEY não configurada.");
  const search = await get(
    "search",
    { part: "snippet", q: query, type: "video", regionCode: "BR", relevanceLanguage: "pt", publishedAfter, order: "viewCount", maxResults: "50" },
    key,
    fetchImpl,
  );
  const ids = parseSearch(search).slice(0, 50);
  if (!ids.length) return [];
  return parseVideos(await get("videos", { part: "snippet,statistics", id: ids.join(","), maxResults: "50" }, key, fetchImpl));
}
