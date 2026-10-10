import "server-only";
import { z } from "zod";
import { structured } from "@/lib/ai/structured";
import { campaignDetail } from "@/lib/analytics";
import type { Repository } from "@/lib/data/repository";
import type { Workspace } from "@/lib/data/types";
import { DISCOVER_SYSTEM } from "@/lib/discover/ai";
import { findNiche, findSubniche } from "@/lib/discover/niches";
import type { DiscoverStore } from "@/lib/discover/store";
import { VERDICT_LABEL } from "./intelligence";
import { normalizeRatio, type FlowScene } from "./flow";
import { resolvePeriod } from "@/lib/tz";

/**
 * "Sobre o que é esta campanha?" — monta o contexto a partir de dados reais
 * (nome, produto, textos/links/CTA dos anúncios, veredictos dos criativos e o
 * kit do produto, se houver). A IA só interpreta; os números vêm prontos.
 */

export interface CampaignBrief {
  campaignId: string;
  name: string;
  objective: string | null;
  product: { name: string; price: number } | null;
  kit: { title: string; niche: string | null; subniche: string | null } | null;
  landingDomains: string[];
  ads: Array<{ name: string; format: string; title: string | null; body: string | null; cta: string | null; verdict: string | null; spend: number; purchases: number }>;
  /** Resumo legível do que o sistema identificou. */
  summary: string[];
}

export async function campaignBrief(repo: Repository, discover: DiscoverStore, ws: Workspace, campaignId: string): Promise<CampaignBrief | null> {
  const [campaigns, products, ads, kits] = await Promise.all([repo.campaigns(), repo.products(), repo.ads(campaignId), discover.listKits()]);
  const c = campaigns.find((x) => x.id === campaignId);
  if (!c) return null;
  const product = products.find((p) => p.id === c.productId) ?? null;
  const kit = product ? kits.find((k) => k.productId === product.id) ?? null : null;
  const detail = await campaignDetail(repo, campaignId, resolvePeriod(ws.timezone, "30d")).catch(() => null);
  const verdicts = new Map((detail?.creatives.ads ?? []).map((a) => [a.id, a]));
  const domains = new Set<string>();
  for (const a of ads) {
    try {
      if (a.creative?.linkUrl) domains.add(new URL(a.creative.linkUrl).hostname.replace(/^www\./, ""));
    } catch {
      // link inválido
    }
  }
  const n = kit ? findNiche(kit.nicheSlug) : undefined;
  const sub = n && kit ? findSubniche(n, kit.subnicheSlug) : undefined;
  const adRows = ads.slice(0, 15).map((a) => {
    const v = verdicts.get(a.id);
    return {
      name: a.name,
      format: a.creative?.format ?? "unknown",
      title: a.creative?.title ?? null,
      body: a.creative?.body ? a.creative.body.slice(0, 500) : null,
      cta: a.creative?.callToAction ?? null,
      verdict: v ? VERDICT_LABEL[v.verdict] : null,
      spend: v?.meta.spend ?? 0,
      purchases: v?.purchases ?? 0,
    };
  });
  const withText = adRows.filter((a) => a.body || a.title).length;
  const summary = [
    `Campanha “${c.name}”${c.objective ? ` (objetivo ${c.objective})` : ""}.`,
    product ? `Produto vinculado: ${product.name} (R$ ${product.price.toFixed(2).replace(".", ",")}).` : "Sem produto vinculado (vincule em Configurações para contexto melhor).",
    kit ? `Kit: ${kit.title}${n ? ` · nicho ${n.name}${sub ? ` › ${sub.name}` : ""}` : ""}.` : "Nenhum kit ligado ao produto.",
    `${ads.length} anúncio(s); ${withText} com texto do anúncio sincronizado${domains.size ? `; página: ${[...domains].join(", ")}` : ""}.`,
    detail ? `${adRows.filter((a) => a.verdict).length} criativo(s) com veredicto nos últimos 30 dias.` : "Sem dados de desempenho no período.",
  ];
  return {
    campaignId,
    name: c.name,
    objective: c.objective,
    product: product ? { name: product.name, price: product.price } : null,
    kit: kit ? { title: kit.title, niche: n?.name ?? null, subniche: sub?.name ?? null } : null,
    landingDomains: [...domains],
    ads: adRows,
    summary,
  };
}

function task(b: CampaignBrief, focus: string | null): string {
  return [
    "Leia os dados reais desta campanha do Meta, identifique sobre o que ela é (produto, público, promessa, ângulos que já usa) e proponha NOVAS ideias de criativos em vídeo para testar.",
    "Para cada ideia: o ângulo, por que pode funcionar (apoiado nos dados: o que já vai bem ou mal), o gancho dos 3 primeiros segundos em português e 2 a 3 cenas com prompt visual em inglês prontas para o Google Flow (ou Higgsfield/Kling), sem texto na tela e sem marcas.",
    "Repita o que tem veredicto positivo em versões novas; não insista no que está abaixo do restante. Se os dados forem poucos, diga isso e sugira testes amplos.",
    "Respeite as políticas do Meta (sem antes/depois, sem promessa de resultado, sem atributos pessoais).",
    focus ? `Foco pedido: ${focus}.` : "",
    "",
    "Dados (JSON):",
    JSON.stringify({ campanha: b.name, objetivo: b.objective, produto: b.product, kit: b.kit, paginas: b.landingDomains, anuncios: b.ads }),
  ]
    .filter((x) => x !== "")
    .join("\n");
}

export const CampaignIdeasSchema = z.object({
  sobre: z.string().describe("Sobre o que é a campanha, em 2 frases"),
  ideias: z
    .array(
      z.object({
        angulo: z.string(),
        por_que: z.string(),
        gancho: z.string(),
        cenas: z.array(z.object({ titulo: z.string(), prompt: z.string(), proporcao: z.string(), duracao_s: z.number() })).describe("2 a 3 cenas"),
      }),
    )
    .describe("4 a 6 ideias"),
});

export type CampaignIdeas = z.infer<typeof CampaignIdeasSchema>;

/** Prompt para IA grátis; o formato volta pelo campo "Colar ideias" (mesmo leitor dos roteiros do kit). */
export function manualCampaignPrompt(b: CampaignBrief, focus: string | null): string {
  return [
    DISCOVER_SYSTEM,
    "",
    "## Tarefa",
    task(b, focus),
    "",
    "## Formato da resposta",
    'Markdown simples. Comece com "Sobre a campanha:" em 2 frases. Depois, para cada ideia: "## Ângulo: <nome>", uma linha "Por que: ...", uma linha "Gancho: ...", e "### Prompts para o Google Flow" com as cenas como "- **<título da cena>** (9:16, 8s): <prompt em inglês>".',
  ].join("\n");
}

export async function generateCampaignIdeas(b: CampaignBrief, focus: string | null): Promise<{ ideas: CampaignIdeas; scenes: FlowScene[] }> {
  const { data } = await structured({ schema: CampaignIdeasSchema, system: DISCOVER_SYSTEM, maxTokens: 8000, user: task(b, focus) });
  const scenes = data.ideias.flatMap((i) =>
    i.cenas.map((c) => ({ title: c.titulo, angle: i.angulo, prompt: c.prompt, ratio: normalizeRatio(c.proporcao), durationS: c.duracao_s || null, variant: "A" as const, hook: i.gancho || null })),
  );
  return { ideas: data, scenes };
}
