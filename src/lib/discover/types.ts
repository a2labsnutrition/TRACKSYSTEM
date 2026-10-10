/** Tipos do módulo Descobrir & Criar. */

export type RefFormat = "video" | "image" | "carousel" | "unknown";

/** Origem de cada dado exibido (a interface sempre mostra). */
export type RefSource = "manual" | "ai_estimate" | `provider:${string}`;

export interface ReferenceAnalysis {
  gancho: string;
  promessa: string;
  angulo: string;
  cta: string;
  tipo_pagina: string;
  por_que_funciona: string[];
  riscos_politica: string[];
  ideias_para_testar: string[];
  analyzedAt?: string;
  model?: string;
}

export interface AdReference {
  id: string;
  source: RefSource;
  sourceUrl: string | null;
  /** ID do anúncio na Biblioteca de Anúncios (se o link for de lá). */
  libraryId: string | null;
  nicheSlug: string | null;
  subnicheSlug: string | null;
  advertiser: string | null;
  format: RefFormat;
  /** Data em que o anúncio começou a rodar (informada pelo usuário ou pelo provedor). */
  firstSeen: string | null;
  /** Variações do mesmo criativo que o anunciante roda (informado). */
  variations: number | null;
  country: string | null;
  price: number | null;
  copy: string | null;
  hook: string | null;
  angle: string | null;
  cta: string | null;
  landingType: string | null;
  landingUrl: string | null;
  notes: string | null;
  tags: string[];
  analysis: ReferenceAnalysis | null;
  collectedAt: string;
}

export interface ReferenceInput {
  sourceUrl?: string | null;
  nicheSlug?: string | null;
  subnicheSlug?: string | null;
  advertiser?: string | null;
  format?: RefFormat;
  firstSeen?: string | null;
  variations?: number | null;
  country?: string | null;
  price?: number | null;
  copy?: string | null;
  hook?: string | null;
  angle?: string | null;
  cta?: string | null;
  landingType?: string | null;
  landingUrl?: string | null;
  notes?: string | null;
  tags?: string[];
}

export interface SwipeCollection {
  id: string;
  name: string;
  items: Array<{ refId: string; note: string | null; addedAt: string }>;
  createdAt: string;
}

/** Estimativa da IA para um nicho (sempre rotulada como estimativa, nunca como dado medido). */
export interface NicheSeed {
  escala_estimada: number;
  saturacao_estimada: number;
  justificativa: string;
  subnichos_em_alta: string[];
  angulos: string[];
  estruturas_oferta: string[];
  formatos_que_mais_aparecem: string[];
  alertas: string[];
  generatedAt: string;
  model: string;
}

export type KitSectionKind = "plan" | "offer" | "landing" | "vsl" | "scripts" | "structure" | "compliance";

export const SECTION_LABEL: Record<KitSectionKind, string> = {
  plan: "Plano de ataque",
  offer: "Oferta",
  landing: "Página de vendas",
  vsl: "VSL",
  scripts: "Roteiros de criativos",
  structure: "Estrutura da campanha",
  compliance: "Conformidade",
};

export const SECTION_ORDER: KitSectionKind[] = ["plan", "offer", "landing", "vsl", "scripts", "structure", "compliance"];

export interface KitInputs {
  productName?: string | null;
  productType?: string | null;
  price?: number | null;
  checkoutUrl?: string | null;
  audienceNotes?: string | null;
  dailyBudget?: number | null;
  /** CPA máximo (equilíbrio) — se vazio, estimado a partir do preço. */
  maxCpa?: number | null;
}

export interface KitRoot {
  id: string;
  title: string;
  nicheSlug: string;
  subnicheSlug: string | null;
  referenceIds: string[];
  productId: string | null;
  inputs: KitInputs;
  createdAt: string;
  updatedAt: string;
}

export interface KitSection {
  id: string;
  kitId: string;
  kind: KitSectionKind;
  version: number;
  /** "structured" = saída da IA/do sistema; "markdown" = editado por você. */
  format: "structured" | "markdown";
  data: unknown;
  note: string | null;
  createdAt: string;
}
