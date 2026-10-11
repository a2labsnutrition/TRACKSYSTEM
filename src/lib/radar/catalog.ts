import type { PolicyLevel } from "@/lib/discover/niches";

/**
 * Radar de Nichos de IA: subnichos (público × promessa) do ramo de IA.
 * Ticket, facilidade e risco de política são REFERÊNCIAS do catálogo (não
 * medidas). A demanda vem do YouTube (medido) e a confirmação, dos seus
 * testes no Meta (medido), ligados pela etiqueta `ia-<slug>` no nome do
 * anúncio, do conjunto ou da campanha.
 */

export interface AiSubniche {
  slug: string;
  name: string;
  /** Para quem é. */
  audience: string;
  /** O que o produto promete (sem promessa de ganho garantido). */
  promise: string;
  /** Busca usada no YouTube (português, Brasil). */
  query: string;
  ticket: { min: number; max: number };
  /** Facilidade de produzir o produto (0–100). */
  ease: number;
  policy: { level: PolicyLevel; reason: string | null };
  /** "catalogo" ou criado por você. */
  origin: "catalogo" | "usuario";
}

const INCOME = "Promessa de renda: o Meta restringe ganhos garantidos ou irreais — fale de habilidade e serviço, não de dinheiro fácil.";

const c = (x: Omit<AiSubniche, "origin">): AiSubniche => ({ ...x, origin: "catalogo" });

export const AI_SUBNICHES: AiSubniche[] = [
  c({ slug: "chatgpt-iniciantes", name: "ChatGPT para iniciantes", audience: "Quem nunca usou IA (35+)", promise: "Usar IA no dia a dia sem complicação", query: "chatgpt para iniciantes", ticket: { min: 19, max: 97 }, ease: 85, policy: { level: "baixo", reason: null } }),
  c({ slug: "servicos-com-ia", name: "Serviços com IA (freelancer)", audience: "Quem quer prestar serviço", promise: "Oferecer serviços usando IA", query: "como ganhar dinheiro com inteligência artificial", ticket: { min: 37, max: 297 }, ease: 70, policy: { level: "alto", reason: INCOME } }),
  c({ slug: "social-media", name: "IA para social media", audience: "Social medias e criadores", promise: "Criar posts e roteiros mais rápido", query: "inteligência artificial para social media", ticket: { min: 47, max: 297 }, ease: 75, policy: { level: "baixo", reason: null } }),
  c({ slug: "imagens", name: "Imagens com IA", audience: "Criadores e pequenos negócios", promise: "Criar imagens profissionais com IA", query: "como criar imagens com inteligência artificial", ticket: { min: 27, max: 197 }, ease: 75, policy: { level: "baixo", reason: null } }),
  c({ slug: "videos", name: "Vídeos com IA", audience: "Criadores de conteúdo", promise: "Produzir vídeos e Reels com IA", query: "como criar vídeos com inteligência artificial", ticket: { min: 37, max: 297 }, ease: 65, policy: { level: "baixo", reason: null } }),
  c({ slug: "influenciador-ia", name: "Influenciador virtual com IA", audience: "Quem quer um perfil sem aparecer", promise: "Criar um personagem/perfil com IA", query: "influenciadora virtual inteligência artificial", ticket: { min: 37, max: 297 }, ease: 60, policy: { level: "medio", reason: "Perfis criados com IA devem ser identificados como conteúdo gerado por IA; evite promessa de renda." } }),
  c({ slug: "concursos", name: "IA para concursos e estudos", audience: "Concurseiros e estudantes", promise: "Estudar e revisar mais rápido com IA", query: "inteligência artificial para estudar concurso", ticket: { min: 27, max: 197 }, ease: 75, policy: { level: "baixo", reason: null } }),
  c({ slug: "professores", name: "IA para professores", audience: "Professores", promise: "Planejar aulas e atividades com IA", query: "inteligência artificial para professores", ticket: { min: 27, max: 197 }, ease: 80, policy: { level: "baixo", reason: null } }),
  c({ slug: "advogados", name: "IA para advogados", audience: "Advogados e estudantes de Direito", promise: "Peças e pesquisas mais rápidas com IA", query: "inteligência artificial para advogados", ticket: { min: 97, max: 697 }, ease: 55, policy: { level: "baixo", reason: "Publicidade de advogados segue o Código de Ética da OAB." } }),
  c({ slug: "contadores", name: "IA para contadores", audience: "Contadores e escritórios", promise: "Automatizar rotinas do escritório", query: "inteligência artificial para contadores", ticket: { min: 97, max: 697 }, ease: 55, policy: { level: "baixo", reason: null } }),
  c({ slug: "corretores", name: "IA para corretores de imóveis", audience: "Corretores", promise: "Anúncios e atendimento com IA", query: "inteligência artificial para corretor de imóveis", ticket: { min: 47, max: 397 }, ease: 70, policy: { level: "medio", reason: "Imóveis/habitação é categoria especial no Meta (segmentação restrita)." } }),
  c({ slug: "negocios-locais", name: "IA para pequenos negócios", audience: "Donos de comércio local", promise: "Vender mais com atendimento e posts por IA", query: "inteligência artificial para pequenos negócios", ticket: { min: 47, max: 497 }, ease: 65, policy: { level: "baixo", reason: null } }),
  c({ slug: "atendimento-whatsapp", name: "Atendimento com IA no WhatsApp", audience: "Negócios que vendem pelo WhatsApp", promise: "Responder clientes automaticamente", query: "chatbot whatsapp inteligência artificial", ticket: { min: 97, max: 997 }, ease: 50, policy: { level: "baixo", reason: null } }),
  c({ slug: "automacao-agentes", name: "Automação e agentes de IA", audience: "Empreendedores e freelancers técnicos", promise: "Criar automações e agentes sem programar", query: "agentes de ia automação n8n", ticket: { min: 97, max: 997 }, ease: 45, policy: { level: "baixo", reason: null } }),
  c({ slug: "prompts-prontos", name: "Pacotes de prompts", audience: "Iniciantes e profissionais", promise: "Prompts prontos para copiar e usar", query: "prompts prontos chatgpt", ticket: { min: 9, max: 47 }, ease: 90, policy: { level: "baixo", reason: null } }),
  c({ slug: "copywriting", name: "IA para copy e vendas", audience: "Afiliados, infoprodutores e vendedores", promise: "Escrever textos que vendem com IA", query: "copywriting com inteligência artificial", ticket: { min: 37, max: 297 }, ease: 70, policy: { level: "medio", reason: INCOME } }),
  c({ slug: "planilhas-excel", name: "IA para Excel e planilhas", audience: "Profissionais de escritório", promise: "Fazer planilhas e relatórios com IA", query: "inteligência artificial excel planilhas", ticket: { min: 27, max: 197 }, ease: 75, policy: { level: "baixo", reason: null } }),
  c({ slug: "musica-ia", name: "Músicas com IA", audience: "Criadores e pequenos negócios", promise: "Criar músicas e jingles com IA", query: "como criar música com inteligência artificial", ticket: { min: 27, max: 197 }, ease: 70, policy: { level: "baixo", reason: null } }),
];

/** Etiqueta que liga anúncios do Meta ao subnicho (vai no nome do anúncio, conjunto ou campanha). */
export function radarTag(slug: string): string {
  return `ia-${slug}`;
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}
