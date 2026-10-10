/**
 * Camada AdLibraryProvider: de onde vêm as referências de anúncios.
 *
 * A API oficial da Biblioteca de Anúncios do Meta cobre anúncios sobre temas
 * sociais/eleições/política (e, na UE, todos os anúncios). Ela NÃO entrega
 * anúncios comerciais do Brasil de forma ampla — por isso há três adaptadores
 * intercambiáveis, e todo dado exibido mostra a origem e a data:
 *  1. manual   — você cola o link (Biblioteca, post, página) e os dados que vê;
 *  2. terceiros — provedor de dados com termos que permitam coleta (via API key);
 *  3. ia       — estimativas de tendência por nicho, rotuladas como estimativa.
 * Sem scraping que viole os termos do Meta.
 */

export type ProviderKind = "manual" | "terceiros" | "ia";

export interface ProviderStatus {
  id: string;
  kind: ProviderKind;
  label: string;
  available: boolean;
  detail: string;
}

export function providerStatuses(opts: { hasAi: boolean; thirdPartyConfigured: boolean }): ProviderStatus[] {
  return [
    {
      id: "manual",
      kind: "manual",
      label: "Importação manual/assistida",
      available: true,
      detail: "Cole o link do anúncio (Biblioteca de Anúncios, post ou página) e os dados que você vê. A IA analisa gancho, promessa, ângulo e CTA.",
    },
    {
      id: "terceiros",
      kind: "terceiros",
      label: "Provedor de dados de terceiros",
      available: opts.thirdPartyConfigured,
      detail: opts.thirdPartyConfigured
        ? "Provedor configurado."
        : "Nenhum provedor conectado. O adaptador está pronto para plugar um serviço cujos termos permitam a coleta (via chave de API).",
    },
    {
      id: "ia",
      kind: "ia",
      label: "Sinais estimados pela IA",
      available: opts.hasAi,
      detail: opts.hasAi
        ? "Estimativas de tendência e de estruturas de oferta por nicho — marcadas como estimativa, não como dado medido."
        : "Configure ANTHROPIC_API_KEY para gerar estimativas por nicho.",
    },
  ];
}

/** Lê o ID de um anúncio a partir de um link da Biblioteca de Anúncios do Meta (ex.: .../ads/library/?id=123). */
export function parseAdLibraryUrl(raw: string | null | undefined): { url: string; libraryId: string | null; isAdLibrary: boolean } | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.replace(/^www\./, "").replace(/^m\./, "");
  const isAdLibrary = /(^|\.)facebook\.com$/.test(host) && u.pathname.startsWith("/ads/library");
  const id = u.searchParams.get("id");
  return { url: u.toString(), libraryId: isAdLibrary && id && /^\d{6,}$/.test(id) ? id : null, isAdLibrary };
}

/** Link para abrir a Biblioteca de Anúncios já filtrada (Brasil, todos os anúncios) com uma busca. */
export function adLibrarySearchUrl(query: string): string {
  const q = new URLSearchParams({ active_status: "active", ad_type: "all", country: "BR", q: query, search_type: "keyword_unordered", media_type: "all" });
  return `https://www.facebook.com/ads/library/?${q.toString()}`;
}
