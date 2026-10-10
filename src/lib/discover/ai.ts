import "server-only";
import { structured } from "@/lib/ai/structured";
import { daysRunning } from "./score";
import { findNiche, findSubniche, type Niche } from "./niches";
import {
  AngleScriptsSchema,
  ComplianceRewriteSchema,
  LandingSchema,
  NicheSeedSchema,
  OfferSchema,
  PlanSchema,
  ReferenceAnalysisSchema,
  VslSchema,
  type OfferContent,
  type PlanContent,
  type ScriptsContent,
} from "./schemas";
import type { AdReference, KitInputs, NicheSeed, ReferenceAnalysis } from "./types";

/**
 * Instruções do estrategista. Estáveis (sem datas nem IDs) para o cache de prompt.
 */
export const DISCOVER_SYSTEM = `Você é estrategista de infoprodutos e gestor de tráfego sênior no Brasil (Meta Ads, checkout Cakto). Você cria planos, ofertas, páginas, VSLs e roteiros para o produtor lançar campanhas.

Regras:
1. Português do Brasil, direto, frases curtas. Valores em R$.
2. Nunca invente dados: nada de números de alunos, faturamentos, depoimentos, prêmios ou estudos que não estejam no JSON. Onde precisar de prova, escreva um marcador entre colchetes, ex.: [DEPOIMENTO REAL DE ALUNO], [PRINT DE RESULTADO REAL].
3. Políticas de anúncios do Meta: nada de promessa de renda garantida ou enriquecimento rápido; nada de antes/depois, promessas de cura ou de perda de peso em prazo; não afirme nem insinue atributos pessoais de quem lê ("você está endividado?", "você tem ansiedade?"); nada de urgência falsa. Em saúde/estética/suplementos, respeite também CONAR e ANVISA.
4. Escassez só ética e verdadeira (bônus por tempo limitado de fato, turma com vagas reais) — use marcadores se depender do produtor.
5. Quando o JSON trouxer "referencias", use-as como inspiração de estrutura, nunca copie texto de concorrentes.
6. Separe o que é recomendação do que é hipótese a testar. Seja específico ao nicho e ao público.`;

function nicheContext(nicheSlug: string, subnicheSlug: string | null) {
  const n = findNiche(nicheSlug);
  const sub = n ? findSubniche(n, subnicheSlug) : undefined;
  return {
    nicho: n?.name ?? nicheSlug,
    subnicho: sub?.name ?? null,
    risco_politica: n ? { nivel: n.policy.level, motivos: n.policy.reasons } : null,
    ticket_comum_rs: n ? `${n.ticket.min} a ${n.ticket.max}` : null,
  };
}

function refsContext(refs: AdReference[]) {
  return refs.slice(0, 12).map((r) => ({
    anunciante: r.advertiser,
    formato: r.format,
    dias_no_ar: daysRunning(r),
    variacoes: r.variations,
    preco_rs: r.price,
    gancho: r.analysis?.gancho ?? r.hook,
    angulo: r.analysis?.angulo ?? r.angle,
    promessa: r.analysis?.promessa ?? null,
    tipo_pagina: r.analysis?.tipo_pagina ?? r.landingType,
    texto: r.copy?.slice(0, 600) ?? null,
  }));
}

export async function analyzeReference(ref: AdReference): Promise<ReferenceAnalysis> {
  const { data, model } = await structured({
    schema: ReferenceAnalysisSchema,
    system: DISCOVER_SYSTEM,
    maxTokens: 4000,
    user: `Analise este anúncio de referência (dados informados pelo produtor; não acesse links):\n${JSON.stringify({
      ...nicheContext(ref.nicheSlug ?? "", ref.subnicheSlug),
      link: ref.sourceUrl,
      anunciante: ref.advertiser,
      formato: ref.format,
      dias_no_ar: daysRunning(ref),
      variacoes: ref.variations,
      preco_rs: ref.price,
      texto_do_anuncio: ref.copy,
      gancho_informado: ref.hook,
      angulo_informado: ref.angle,
      cta: ref.cta,
      pagina: ref.landingType,
      observacoes: ref.notes,
    })}`,
  });
  return { ...data, analyzedAt: new Date().toISOString(), model };
}

export async function generateNicheSeed(niche: Niche): Promise<NicheSeed> {
  const { data, model } = await structured({
    schema: NicheSeedSchema,
    system: DISCOVER_SYSTEM,
    maxTokens: 4000,
    user: `Estime sinais de mercado para o nicho abaixo no Brasil (Meta Ads, infoprodutos). Você NÃO tem dados medidos: dê estimativas honestas, deixando isso claro na justificativa.\n${JSON.stringify({
      nicho: niche.name,
      subnichos: niche.subniches.map((s) => s.name),
      risco_politica: niche.policy,
      ticket_comum_rs: niche.ticket,
    })}`,
  });
  return { ...data, generatedAt: new Date().toISOString(), model };
}

export interface KitContext {
  nicheSlug: string;
  subnicheSlug: string | null;
  inputs: KitInputs;
  refs: AdReference[];
  plan?: PlanContent | null;
  offer?: OfferContent | null;
}

function kitPayload(k: KitContext, extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    ...nicheContext(k.nicheSlug, k.subnicheSlug),
    produto: {
      nome: k.inputs.productName ?? null,
      tipo: k.inputs.productType ?? null,
      preco_rs: k.inputs.price ?? null,
      publico_observacoes: k.inputs.audienceNotes ?? null,
    },
    referencias: refsContext(k.refs),
    plano_de_ataque: k.plan ?? null,
    oferta: k.offer ?? null,
    ...extra,
  });
}

export async function generatePlan(k: KitContext) {
  return structured({
    schema: PlanSchema,
    system: DISCOVER_SYSTEM,
    maxTokens: 12000,
    user: `Monte o plano de ataque para lançar um infoproduto neste nicho: público (dores, desejos, objeções), no mínimo 5 ângulos, tipo de produto ideal, faixa de preço, estrutura de oferta e a estratégia de página e de criativo que tende a vender mais neste nicho, com justificativa.\n${kitPayload(k)}`,
  });
}

export async function generateOffer(k: KitContext) {
  return structured({
    schema: OfferSchema,
    system: DISCOVER_SYSTEM,
    maxTokens: 12000,
    user: `Escreva a oferta completa a partir do plano de ataque: nome, promessa, mecanismo, estrutura do produto, bônus, garantia, preço e ancoragem, order bump, upsell e FAQ de objeções. Se o produto já tem preço definido, respeite.\n${kitPayload(k)}`,
  });
}

export async function generateLanding(k: KitContext) {
  return structured({
    schema: LandingSchema,
    system: DISCOVER_SYSTEM,
    maxTokens: 16000,
    user: `Escreva a página de vendas: estrutura de seções recomendada para o nicho e a copy completa de cada seção, pronta para publicar. Marque quais seções têm botão de checkout. Paleta em hexadecimal.\n${kitPayload(k)}`,
  });
}

export async function generateVsl(k: KitContext) {
  return structured({
    schema: VslSchema,
    system: DISCOVER_SYSTEM,
    maxTokens: 16000,
    user: `Escreva o roteiro da VSL em duas versões (longa e curta de 60–90s), com marcação de tempo, fala completa e sugestão de b-roll/telas.\n${kitPayload(k)}`,
  });
}

/** Roteiros: uma chamada por ângulo, em paralelo (cabe no limite de tempo da função). */
export async function generateScripts(k: KitContext, angles: string[]): Promise<{ data: ScriptsContent; model: string }> {
  const list = angles.slice(0, 6);
  if (!list.length) throw new Error("Gere o plano de ataque antes: os roteiros partem dos ângulos dele.");
  const results = await Promise.all(
    list.map((angulo) =>
      structured({
        schema: AngleScriptsSchema,
        system: DISCOVER_SYSTEM,
        maxTokens: 10000,
        user: `Escreva os criativos para o ângulo "${angulo}": no mínimo 10 ganchos diferentes, 3 roteiros (15s, 30s e 60s) em formatos variados (UGC, talking head, demonstração, storytelling, depoimento) com texto principal, título, descrição e a hipótese de teste de cada um, e 3 a 5 prompts de cena para gerar vídeo/imagem no Google Flow (em inglês, com proporção 9:16, 1:1 ou 4:5).\n${kitPayload({ ...k, plan: null }, { angulo, oferta_resumo: k.offer ? { nome: k.offer.nome, promessa: k.offer.promessa_principal, preco: k.offer.preco } : null })}`,
      }),
    ),
  );
  return { data: { angulos: results.map((r) => r.data) }, model: results[0]?.model ?? "" };
}

export async function generateComplianceRewrites(flags: Array<{ trecho: string; regra: string; secao: string }>, k: KitContext) {
  return structured({
    schema: ComplianceRewriteSchema,
    system: DISCOVER_SYSTEM,
    maxTokens: 8000,
    user: `Estes trechos do kit foram sinalizados pelo verificador de políticas. Para cada um, explique o problema e proponha uma reescrita que mantenha a força de venda sem violar as políticas do Meta (e CONAR/ANVISA quando for saúde).\n${JSON.stringify({ ...nicheContext(k.nicheSlug, k.subnicheSlug), trechos: flags.slice(0, 40) })}`,
  });
}
