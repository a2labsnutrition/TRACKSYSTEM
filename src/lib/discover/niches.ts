/**
 * Catálogo de nichos e subnichos de infoprodutos (Brasil).
 *
 * Os atributos aqui são REFERÊNCIAS INICIAIS do sistema (não dados medidos):
 *  - ticket: faixa de preço comum para o tipo de produto no nicho;
 *  - ease: facilidade de produzir o produto (0–100);
 *  - policy: risco frente às políticas de anúncios do Meta (e, quando cabe,
 *    regras do CONAR/ANVISA), com os motivos.
 * A interface sempre mostra essa origem ("catálogo") — os sinais de mercado
 * vêm das referências que você importa (medido) ou da IA (estimativa).
 */

export type PolicyLevel = "baixo" | "medio" | "alto";

export interface Subniche {
  slug: string;
  name: string;
}

export interface Niche {
  slug: string;
  name: string;
  subniches: Subniche[];
  ticket: { min: number; max: number };
  /** Facilidade de produzir o produto (0–100). */
  ease: number;
  policy: { level: PolicyLevel; reasons: string[] };
}

const s = (name: string): Subniche => ({
  slug: name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, ""),
  name,
});

const HEALTH = "Saúde e corpo: o Meta proíbe antes/depois, promessas de resultado e conteúdo que gere autopercepção negativa; ANVISA/CONAR restringem alegações terapêuticas.";
const INCOME = "Promessas de renda: o Meta restringe ganhos garantidos ou irreais e esquemas de enriquecimento rápido.";
const FINANCE = "Serviços financeiros: anúncios de crédito, investimentos e cripto têm regras específicas no Meta e na CVM.";
const PERSONAL = "Atributos pessoais: não pode afirmar ou insinuar condição de saúde, finanças, religião ou relacionamento de quem vê o anúncio.";

export const NICHES: Niche[] = [
  { slug: "emagrecimento", name: "Emagrecimento", subniches: ["Pós-parto", "Menopausa", "Emagrecimento masculino", "Jejum intermitente", "Receitas fit", "Reeducação alimentar", "Lipedema"].map(s), ticket: { min: 37, max: 297 }, ease: 60, policy: { level: "alto", reasons: [HEALTH, PERSONAL] } },
  { slug: "saude-bem-estar", name: "Saúde e bem-estar", subniches: ["Sono", "Ansiedade (bem-estar)", "Postura e dores", "Alimentação saudável", "Hormônios femininos", "Saúde intestinal"].map(s), ticket: { min: 37, max: 297 }, ease: 50, policy: { level: "alto", reasons: [HEALTH, PERSONAL] } },
  { slug: "fitness", name: "Fitness", subniches: ["Treino em casa", "Hipertrofia", "Calistenia", "Mobilidade", "Corrida", "Treino para iniciantes"].map(s), ticket: { min: 27, max: 197 }, ease: 65, policy: { level: "medio", reasons: [HEALTH] } },
  { slug: "relacionamentos", name: "Relacionamentos", subniches: ["Reconquista", "Autoestima feminina", "Comunicação no casamento", "Paquera", "Pós-término"].map(s), ticket: { min: 27, max: 197 }, ease: 70, policy: { level: "medio", reasons: [PERSONAL, "Conteúdo de namoro/relacionamento tem restrições de segmentação e de tom no Meta."] } },
  { slug: "financas-pessoais", name: "Finanças pessoais", subniches: ["Sair das dívidas", "Organização financeira", "Planilhas de orçamento", "Finanças para casais", "Primeira reserva"].map(s), ticket: { min: 19, max: 197 }, ease: 75, policy: { level: "medio", reasons: [PERSONAL, FINANCE] } },
  { slug: "investimentos", name: "Investimentos", subniches: ["Renda fixa para iniciantes", "Ações e dividendos", "Fundos imobiliários", "Previdência", "Cripto (educacional)"].map(s), ticket: { min: 47, max: 997 }, ease: 55, policy: { level: "alto", reasons: [FINANCE, INCOME] } },
  { slug: "renda-extra", name: "Renda extra", subniches: ["Freelancer", "Revenda", "Serviços com IA", "Afiliados", "Confeitaria para vender", "Renda com artesanato"].map(s), ticket: { min: 19, max: 297 }, ease: 70, policy: { level: "alto", reasons: [INCOME] } },
  { slug: "marketing-digital", name: "Marketing digital", subniches: ["Tráfego pago", "Social media", "Lançamentos", "Copywriting", "Instagram para negócios", "Lojas virtuais"].map(s), ticket: { min: 47, max: 1997 }, ease: 60, policy: { level: "medio", reasons: [INCOME] } },
  { slug: "vendas", name: "Vendas", subniches: ["Vendas pelo WhatsApp", "Vendas B2B", "Negociação", "Atendimento que vende", "Vendas para corretores"].map(s), ticket: { min: 47, max: 997 }, ease: 65, policy: { level: "baixo", reasons: [] } },
  { slug: "idiomas", name: "Idiomas", subniches: ["Inglês para iniciantes", "Inglês para viagem", "Espanhol", "Inglês para crianças", "Conversação"].map(s), ticket: { min: 47, max: 497 }, ease: 50, policy: { level: "baixo", reasons: [] } },
  { slug: "concursos", name: "Concursos", subniches: ["Policiais", "Tribunais", "Bancários", "ENEM", "Redação", "Mapas mentais"].map(s), ticket: { min: 37, max: 997 }, ease: 40, policy: { level: "baixo", reasons: [] } },
  { slug: "estudos", name: "Estudos e produtividade", subniches: ["Técnicas de estudo", "Memorização", "Organização e rotina", "Leitura dinâmica", "TDAH (organização)"].map(s), ticket: { min: 27, max: 197 }, ease: 70, policy: { level: "baixo", reasons: [] } },
  { slug: "carreira", name: "Carreira", subniches: ["Currículo e entrevista", "Transição de carreira", "Liderança", "Oratória", "LinkedIn"].map(s), ticket: { min: 37, max: 497 }, ease: 70, policy: { level: "baixo", reasons: [] } },
  { slug: "tecnologia-ia", name: "Tecnologia e IA", subniches: ["IA para iniciantes", "Serviços com IA", "Prompts prontos", "Automação com IA", "IA para negócios locais"].map(s), ticket: { min: 19, max: 497 }, ease: 75, policy: { level: "medio", reasons: [INCOME] } },
  { slug: "programacao", name: "Programação", subniches: ["Lógica para iniciantes", "Web front-end", "Python", "No-code", "Análise de dados"].map(s), ticket: { min: 47, max: 1497 }, ease: 40, policy: { level: "baixo", reasons: [] } },
  { slug: "design", name: "Design", subniches: ["Canva", "Design para redes sociais", "Identidade visual", "UI/UX", "Edição de fotos"].map(s), ticket: { min: 27, max: 497 }, ease: 60, policy: { level: "baixo", reasons: [] } },
  { slug: "foto-video", name: "Fotografia e vídeo", subniches: ["Fotografia com celular", "Edição de vídeo", "Filmmaking", "Vídeos para Reels", "Fotografia de produtos"].map(s), ticket: { min: 37, max: 697 }, ease: 50, policy: { level: "baixo", reasons: [] } },
  { slug: "musica", name: "Música", subniches: ["Violão", "Teclado", "Canto", "Produção musical", "Bateria"].map(s), ticket: { min: 47, max: 697 }, ease: 45, policy: { level: "baixo", reasons: [] } },
  { slug: "culinaria", name: "Culinária", subniches: ["Confeitaria", "Marmitas", "Pães", "Doces para vender", "Comida saudável", "Low carb"].map(s), ticket: { min: 19, max: 297 }, ease: 70, policy: { level: "medio", reasons: ["Quando a promessa é de renda (vender doces) ou de saúde (low carb, emagrecer), valem as regras desses temas."] } },
  { slug: "artesanato", name: "Artesanato", subniches: ["Crochê", "Bordado", "Velas e sabonetes", "Biscuit", "Costura", "Papelaria personalizada"].map(s), ticket: { min: 19, max: 197 }, ease: 70, policy: { level: "baixo", reasons: [] } },
  { slug: "pets", name: "Pets", subniches: ["Adestramento", "Alimentação natural", "Comportamento de gatos", "Banho e tosa", "Filhotes"].map(s), ticket: { min: 27, max: 297 }, ease: 60, policy: { level: "baixo", reasons: [] } },
  { slug: "maternidade", name: "Maternidade", subniches: ["Sono do bebê", "Introdução alimentar", "Amamentação", "Gestação", "Disciplina positiva"].map(s), ticket: { min: 27, max: 297 }, ease: 60, policy: { level: "medio", reasons: [HEALTH] } },
  { slug: "espiritualidade", name: "Espiritualidade", subniches: ["Meditação", "Oração e devocional", "Tarô", "Astrologia", "Leis da atração"].map(s), ticket: { min: 19, max: 297 }, ease: 70, policy: { level: "medio", reasons: [PERSONAL, "Crenças religiosas são atributo pessoal protegido; promessas de resultado (dinheiro, cura) agravam o risco."] } },
  { slug: "desenvolvimento-pessoal", name: "Desenvolvimento pessoal", subniches: ["Autoestima", "Disciplina", "Inteligência emocional", "Hábitos", "Propósito"].map(s), ticket: { min: 19, max: 497 }, ease: 75, policy: { level: "medio", reasons: [PERSONAL] } },
  { slug: "beleza", name: "Beleza", subniches: ["Maquiagem", "Cabelos cacheados", "Skincare", "Unhas", "Design de sobrancelhas", "Cílios"].map(s), ticket: { min: 27, max: 497 }, ease: 55, policy: { level: "medio", reasons: ["Antes/depois e promessas estéticas são restritos; procedimentos podem envolver ANVISA."] } },
  { slug: "moda", name: "Moda", subniches: ["Consultoria de imagem", "Moda plus size", "Costura de roupas", "Revenda de roupas", "Estilo masculino"].map(s), ticket: { min: 27, max: 497 }, ease: 60, policy: { level: "baixo", reasons: [] } },
  { slug: "imoveis", name: "Imóveis", subniches: ["Corretor iniciante", "Leilão de imóveis", "Investir em imóveis", "Airbnb", "Financiamento"].map(s), ticket: { min: 97, max: 1997 }, ease: 45, policy: { level: "alto", reasons: ["Habitação é categoria especial no Meta (segmentação restrita).", FINANCE] } },
  { slug: "direito", name: "Direito", subniches: ["OAB", "Direito do consumidor", "Advocacia digital", "Direito previdenciário", "Concursos jurídicos"].map(s), ticket: { min: 47, max: 997 }, ease: 45, policy: { level: "baixo", reasons: ["Publicidade de advogados segue o Código de Ética da OAB."] } },
  { slug: "contabilidade", name: "Contabilidade", subniches: ["MEI", "Imposto de renda", "Abrir empresa", "Contabilidade para leigos", "Departamento pessoal"].map(s), ticket: { min: 37, max: 697 }, ease: 55, policy: { level: "baixo", reasons: [] } },
  { slug: "agro", name: "Agro", subniches: ["Horta em casa", "Criação de galinhas", "Gestão rural", "Piscicultura", "Plantas e jardinagem"].map(s), ticket: { min: 27, max: 497 }, ease: 55, policy: { level: "baixo", reasons: [] } },
  { slug: "educacao-infantil", name: "Educação infantil", subniches: ["Alfabetização", "Atividades para imprimir", "Educação montessoriana", "Reforço escolar", "Brincadeiras pedagógicas"].map(s), ticket: { min: 19, max: 197 }, ease: 70, policy: { level: "baixo", reasons: [] } },
  { slug: "esportes-hobbies", name: "Esportes e hobbies", subniches: ["Xadrez", "Pesca", "Jardinagem", "Games", "Desenho"].map(s), ticket: { min: 27, max: 297 }, ease: 60, policy: { level: "baixo", reasons: [] } },
];

export function findNiche(slug: string): Niche | undefined {
  return NICHES.find((n) => n.slug === slug);
}

export function findSubniche(niche: Niche, slug: string | null | undefined): Subniche | undefined {
  return slug ? niche.subniches.find((x) => x.slug === slug) : undefined;
}

export const POLICY_LABEL: Record<PolicyLevel, string> = { baixo: "Risco de política baixo", medio: "Risco de política médio", alto: "Risco de política alto" };

/** Risco 0–100 a partir do nível (para o score). */
export const POLICY_RISK: Record<PolicyLevel, number> = { baixo: 15, medio: 50, alto: 85 };
