import "server-only";
import { assertPublicUrl } from "@/lib/tracking/verify";

/**
 * Lê a página de destino da campanha (só texto público: título, descrição,
 * títulos e começo do conteúdo) para entender sobre o que é a oferta.
 * Mesma proteção contra endereços internos do verificador de instalação.
 */

export interface LandingSnapshot {
  url: string;
  title: string | null;
  description: string | null;
  headings: string[];
  text: string;
}

const decode = (s: string) =>
  s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));

const clean = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

export function parseLandingHtml(html: string, url: string): LandingSnapshot {
  const meta = (name: string) =>
    new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=["']([^"']*)["']`, "i").exec(html)?.[1] ??
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["']${name}["']`, "i").exec(html)?.[1] ??
    null;
  const title = meta("og:title") ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? null;
  const description = meta("og:description") ?? meta("description");
  const body = html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const headings = [...body.matchAll(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi)].map((m) => clean(m[1])).filter((h) => h.length > 2).slice(0, 15);
  const text = clean(body.replace(/<\/(p|div|h\d|li|section|br)>/gi, ". ")).slice(0, 2500);
  return { url, title: title ? clean(title) : null, description: description ? clean(description) : null, headings, text };
}

export async function fetchLandingSnapshot(raw: string): Promise<LandingSnapshot | null> {
  try {
    const url = await assertPublicUrl(raw);
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(8000),
      headers: { "user-agent": "Mozilla/5.0 (compatible; CentralDeComando/1.0; +analise-de-pagina)", accept: "text/html" },
      cache: "no-store",
    });
    if (!res.ok || !/html/i.test(res.headers.get("content-type") ?? "")) return null;
    const html = (await res.text()).slice(0, 400_000);
    return parseLandingHtml(html, url.toString());
  } catch {
    return null;
  }
}
