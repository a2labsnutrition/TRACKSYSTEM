import "server-only";
import { z } from "zod";
import { structured } from "@/lib/ai/structured";
import { campaignDetail } from "@/lib/analytics";
import type { Repository } from "@/lib/data/repository";
import type { Workspace } from "@/lib/data/types";
import { DISCOVER_SYSTEM } from "@/lib/discover/ai";
import { findNiche, findSubniche } from "@/lib/discover/niches";
import type { DiscoverStore } from "@/lib/discover/store";
import { resolvePeriod } from "@/lib/tz";
import { ASSERTIVENESS_LABEL, assessAds, type AdAssessment, type Assertiveness } from "./assertiveness";
import { normalizeRatio, type FlowScene } from "./flow";
import { VERDICT_LABEL, type CreativeVerdict } from "./intelligence";
import { fetchLandingSnapshot, type LandingSnapshot } from "./landing-snapshot";

/**
 * "Sobre o que é esta campanha e o que está funcionando?" — contexto montado a
 * partir de dados reais: anúncios (textos, títulos, CTA, links, formato,
 * miniatura), desempenho de cada um nos últimos 30 dias (veredicto estatístico
 * + gancho/retenção/CTR comparados à campanha), página de destino, produto e
 * kit. A IA interpreta; os números já vêm calculados.
 */

export interface BriefAd {
  id: string;
  name: string;
  active: boolean;
  format: string;
  thumbnailUrl: string | null;
  title: string | null;
  texts: string[];
  headlines: string[];
  cta: string | null;
  link: string | null;
  spend: number;
  impressions: number;
  purchases: number;
  cpa: number | null;
  hookRate: number | null;
  holdRate: number | null;
  ctrLink: number | null;
  retention: { p25: number | null; p50: number | null; p75: number | null; p100: number | null } | null;
  verdict: CreativeVerdict | null;
  verdictLabel: string | null;
  reasons: string[];
  assessment: AdAssessment | null;
  level: Assertiveness;
}

export interface CampaignBrief {
  campaignId: string;
  name: string;
  objective: string | null;
  product: { name: string; price: number } | null;
  kit: { title: string; niche: string | null; subniche: string | null } | null;
  landing: LandingSnapshot | null;
  ads: BriefAd[];
  missingText: number;
  summary: string[];
}

export async function campaignBrief(repo: Repository, discover: DiscoverStore, ws: Workspace, campaignId: string, opts: { landing?: boolean } = {}): Promise<CampaignBrief | null> {
  const [campaigns, products, ads, kits] = await Promise.all([repo.campaigns(), repo.products(), repo.ads(campaignId), discover.listKits()]);
  const c = campaigns.find((x) => x.id === campaignId);
  if (!c) return null;
  const product = products.find((p) => p.id === c.productId) ?? null;
  const kit = product ? (kits.find((k) => k.productId === product.id) ?? null) : null;
  const detail = await campaignDetail(repo, campaignId, resolvePeriod(ws.timezone, "30d")).catch(() => null);
  const perf = new Map((detail?.creatives.ads ?? []).map((a) => [a.id, a]));

  const assessed = assessAds(
    ads.map((a) => {
      const p = perf.get(a.id);
      return {
        id: a.id,
        impressions: p?.meta.impressions ?? 0,
        isVideo: a.creative?.format === "video" || Boolean(p?.retention),
        verdict: p?.verdict ?? "pouco_gasto",
        hookRate: p?.derived.hookRate ?? null,
        holdRate: p?.derived.holdRate ?? null,
        ctrLink: p?.derived.ctrLink ?? null,
        connectRate: p?.derived.connectRate ?? null,
        fatigued: Boolean(p?.fatigue?.fatigued),
      };
    }),
  );

  const briefAds: BriefAd[] = ads
    .map((a) => {
      const p = perf.get(a.id);
      const cr = a.creative;
      const texts = (cr?.texts?.length ? cr.texts : [cr?.body]).filter((x): x is string => Boolean(x)).slice(0, 4);
      const as = assessed.get(a.id) ?? null;
      return {
        id: a.id,
        name: a.name,
        active: a.effectiveStatus === "ACTIVE",
        format: cr?.format ?? "unknown",
        thumbnailUrl: cr?.thumbnailUrl ?? cr?.imageUrl ?? null,
        title: cr?.title ?? null,
        texts: texts.map((t) => t.slice(0, 600)),
        headlines: (cr?.headlines?.length ? cr.headlines : [cr?.title]).filter((x): x is string => Boolean(x)).slice(0, 4),
        cta: cr?.callToAction ?? null,
        link: cr?.linkUrl ?? null,
        spend: p?.meta.spend ?? 0,
        impressions: p?.meta.impressions ?? 0,
        purchases: p?.purchases ?? 0,
        cpa: p?.cpa ?? null,
        hookRate: p?.derived.hookRate ?? null,
        holdRate: p?.derived.holdRate ?? null,
        ctrLink: p?.derived.ctrLink ?? null,
        retention: p?.retention ?? null,
        verdict: p?.verdict ?? null,
        verdictLabel: p ? VERDICT_LABEL[p.verdict] : null,
        reasons: p?.reasons ?? [],
        assessment: as,
        level: as?.level ?? "sem_dados",
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || b.spend - a.spend);

  // Página: o link mais usado nos anúncios
  const linkCount = new Map<string, number>();
  for (const a of briefAds) if (a.link) linkCount.set(a.link, (linkCount.get(a.link) ?? 0) + 1);
  const mainLink = [...linkCount.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const landing = opts.landing !== false && mainLink ? await fetchLandingSnapshot(mainLink) : null;

  const n = kit ? findNiche(kit.nicheSlug) : undefined;
  const sub = n && kit ? findSubniche(n, kit.subnicheSlug) : undefined;
  const missingText = briefAds.filter((a) => !a.texts.length && !a.headlines.length).length;
  const count = (l: Assertiveness) => briefAds.filter((a) => a.level === l).length;
  const summary = [
    `Campanha “${c.name}”${c.objective ? ` (objetivo ${c.objective})` : ""}.`,
    product ? `Produto vinculado: ${product.name} (R$ ${product.price.toFixed(2).replace(".", ",")}).` : "Sem produto vinculado (vincule em Configurações para o CPA máximo e o contexto).",
    landing
      ? `Página: ${landing.title ?? new URL(landing.url).hostname}${landing.description ? ` — ${landing.description.slice(0, 160)}` : ""}.`
      : mainLink
        ? `Página ${mainLink} não pôde ser lida (bloqueada ou fora do ar).`
        : "Nenhum link de página nos anúncios sincronizados.",
    `${briefAds.length} anúncio(s), ${briefAds.filter((a) => a.active).length} ativo(s), ${briefAds.filter((a) => a.format === "video").length} vídeo(s).`,
    missingText
      ? `${missingText} anúncio(s) sem texto sincronizado — o texto chega na próxima sincronização (Conexões → Sincronizar agora); publicações antigas da página podem exigir permissão de leitura da página.`
      : "Textos de todos os anúncios sincronizados.",
    `Assertividade (30 dias): ${count("vendendo_acima")} vendendo acima, ${count("promissor")} promissor(es), ${count("na_media")} na média, ${count("fraco")} fraco(s), ${count("sem_dados")} com pouco dado.`,
    kit ? `Kit: ${kit.title}${n ? ` · nicho ${n.name}${sub ? ` › ${sub.name}` : ""}` : ""}.` : "",
  ].filter(Boolean);

  return {
    campaignId,
    name: c.name,
    objective: c.objective,
    product: product ? { name: product.name, price: product.price } : null,
    kit: kit ? { title: kit.title, niche: n?.name ?? null, subniche: sub?.name ?? null } : null,
    landing,
    ads: briefAds,
    missingText,
    summary,
  };
}

const r3 = (v: number | null) => (v == null ? null : Math.round(v * 1000) / 1000);

function payload(b: CampaignBrief) {
  return JSON.stringify({
    campanha: b.name,
    objetivo: b.objective,
    produto: b.product,
    kit: b.kit,
    pagina: b.landing ? { titulo: b.landing.title, descricao: b.landing.description, titulos_da_pagina: b.landing.headings, texto_inicio: b.landing.text.slice(0, 1500) } : null,
    anuncios: b.ads.slice(0, 15).map((a, i) => ({
      n: i + 1,
      nome: a.name,
      ativo: a.active,
      formato: a.format,
      textos: a.texts,
      titulos: a.headlines,
      cta: a.cta,
      gasto_rs: Math.round(a.spend),
      impressoes: a.impressions,
      vendas: a.purchases,
      cpa_rs: a.cpa != null ? Math.round(a.cpa) : null,
      taxa_gancho_3s: r3(a.hookRate),
      retencao_thruplay: r3(a.holdRate),
      ctr_link: r3(a.ctrLink),
      retencao_video: a.retention,
      veredicto_vendas: a.verdictLabel,
      assertividade: ASSERTIVENESS_LABEL[a.level],
      pontos_fortes: a.assessment?.strengths ?? [],
      pontos_fracos: a.assessment?.weaknesses ?? [],
    })),
  });
}

function task(b: CampaignBrief, focus: string | null, withImages: number): string {
  return [
    "Você é o estrategista de criativos desta campanha do Meta. Com os dados reais abaixo:",
    "1) Diga sobre o que é a campanha (produto, público, promessa) e quais ângulos os anúncios atuais já usam.",
    "2) Avalie cada anúncio: por que provavelmente está indo bem ou mal, apoiado nos números (gancho, retenção, CTR, vendas). Nunca chame de vencedor sem o veredicto comprovado.",
    "3) Proponha NOVOS criativos para testar: variações do que tem melhor sinal (novo gancho, outra pessoa/cenário, outro início) E pelo menos 3 ângulos que a campanha ainda NÃO usa. Para cada ideia: ângulo, por que testar (hipótese ligada aos dados), gancho dos 3 primeiros segundos em português e 2 a 3 cenas com prompt visual em inglês prontas para o Google Flow/Higgsfield/Kling, sem texto na tela e sem marcas.",
    "Respeite as políticas do Meta: sem antes/depois, sem promessa de resultado, sem atributos pessoais.",
    withImages ? `As ${withImages} imagens acima são as miniaturas dos ${withImages} primeiros anúncios da lista, na mesma ordem (n = 1, 2, …): use o visual delas na avaliação.` : "",
    focus ? `Foco pedido: ${focus}.` : "",
    "",
    "Dados (JSON):",
    payload(b),
  ]
    .filter((x) => x !== "")
    .join("\n");
}

export const CampaignIdeasSchema = z.object({
  sobre: z.string().describe("Sobre o que é a campanha e quais ângulos já usa, 2–3 frases"),
  avaliacao: z
    .array(z.object({ anuncio: z.string().describe("Nome do anúncio"), leitura: z.string().describe("Por que está indo bem/mal, citando os números") }))
    .describe("Uma linha por anúncio com dados"),
  ideias: z
    .array(
      z.object({
        angulo: z.string(),
        tipo: z.string().describe("variação do que funciona | ângulo novo"),
        por_que: z.string(),
        gancho: z.string(),
        cenas: z.array(z.object({ titulo: z.string(), prompt: z.string(), proporcao: z.string(), duracao_s: z.number() })).describe("2 a 3 cenas"),
      }),
    )
    .describe("5 a 8 ideias"),
});

export type CampaignIdeas = z.infer<typeof CampaignIdeasSchema>;

/** Prompt para IA grátis; a resposta volta em "Colar ideias" (mesmo leitor dos roteiros do kit). */
export function manualCampaignPrompt(b: CampaignBrief, focus: string | null): string {
  return [
    DISCOVER_SYSTEM,
    "",
    "## Tarefa",
    task(b, focus, 0),
    b.ads.some((a) => a.thumbnailUrl) ? "\n(Se puder, anexe prints dos seus anúncios nesta conversa para a IA ver o visual.)" : "",
    "",
    "## Formato da resposta",
    'Markdown simples. Comece com "Sobre a campanha:" (2–3 frases) e "Avaliação:" (uma linha por anúncio). Depois, para cada ideia: "## Ângulo: <nome>", "Por que: ...", "Gancho: ...", e "### Prompts para o Google Flow" com as cenas como "- **<título da cena>** (9:16, 8s): <prompt em inglês>".',
  ].join("\n");
}

/** Baixa as miniaturas (Meta CDN) para a IA ver o visual dos anúncios. */
async function thumbnails(ads: BriefAd[], max = 6) {
  const out: Array<{ mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string }> = [];
  for (const a of ads.slice(0, max)) {
    if (!a.thumbnailUrl?.startsWith("https://")) break;
    try {
      const res = await fetch(a.thumbnailUrl, { signal: AbortSignal.timeout(6000), cache: "no-store" });
      const type = (res.headers.get("content-type") ?? "").split(";")[0];
      if (!res.ok || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type)) break;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > 3_000_000) break;
      out.push({ mediaType: type as "image/jpeg", data: buf.toString("base64") });
    } catch {
      break; // mantém a ordem: para na primeira falha
    }
  }
  return out;
}

export async function generateCampaignIdeas(b: CampaignBrief, focus: string | null): Promise<{ ideas: CampaignIdeas; scenes: FlowScene[]; sawImages: number }> {
  const images = await thumbnails(b.ads);
  let data: CampaignIdeas;
  try {
    ({ data } = await structured({ schema: CampaignIdeasSchema, system: DISCOVER_SYSTEM, maxTokens: 12000, user: task(b, focus, images.length), images }));
  } catch (e) {
    if (!images.length) throw e;
    ({ data } = await structured({ schema: CampaignIdeasSchema, system: DISCOVER_SYSTEM, maxTokens: 12000, user: task(b, focus, 0) }));
    images.length = 0;
  }
  const scenes = data.ideias.flatMap((i) =>
    i.cenas.map((c) => ({ title: c.titulo, angle: i.angulo, prompt: c.prompt, ratio: normalizeRatio(c.proporcao), durationS: c.duracao_s || null, variant: "A" as const, hook: i.gancho || null })),
  );
  return { ideas: data, scenes, sawImages: images.length };
}
