import { z } from "zod";

/** Plano do Claudinho: estrutura fixa (saída estruturada da IA e do plano automático). */

export const ACTIONS = [
  "pausar",
  "reduzir_orcamento",
  "aumentar_orcamento",
  "manter",
  "duplicar",
  "novo_criativo",
  "ajustar_funil",
  "corrigir_tracking",
  "aguardar",
] as const;

export const OFFER_ROLES = ["escalar", "manter", "consertar_funil", "cortar", "testar"] as const;

export const PlanoSchema = z.object({
  situacao: z.object({
    resumo: z.string().describe("2-3 frases: onde está o líquido do mês, a projeção e o que mais pesa, com números"),
    vai_bater_a_meta: z.enum(["sim", "nao", "incerto"]),
  }),
  diagnostico: z.array(z.string()).describe("3 a 5 pontos com números: o que gera e o que destrói lucro"),
  ofertas: z
    .array(
      z.object({
        produto: z.string(),
        papel: z.enum(OFFER_ROLES),
        lucro_por_cliente: z.string().describe('Ex.: "R$ 54,10" ou "−R$ 2,30" ou "sem dados"'),
        explicacao: z.string(),
      }),
    )
    .describe("Uma linha por oferta com campanhas"),
  acoes_hoje: z
    .array(
      z.object({
        prioridade: z.number().describe("1 = mais importante"),
        campanha: z.string().nullable().describe("Nome exato da campanha, ou null se for ação de funil/criativo"),
        acao: z.enum(ACTIONS),
        valor_atual: z.string().nullable().describe('Orçamento atual NA MOEDA DA CONTA com o equivalente, ex.: "US$ 40,00/dia (≈ R$ 222)"'),
        valor_novo: z.string().nullable().describe('Novo orçamento NA MOEDA DA CONTA, ex.: "US$ 48,00/dia (≈ R$ 266)"'),
        quando: z.string().describe('Ex.: "agora", "hoje perto da meia-noite (fuso da conta)", "amanhã cedo"'),
        motivo: z.string().describe("Com os números que justificam"),
        reverter_se: z.string().describe("Condição observável para desfazer"),
      }),
    )
    .describe("No máximo 6 ações, em ordem de impacto no líquido"),
  plano_7_dias: z.array(z.object({ quando: z.string(), foco: z.string(), acoes: z.array(z.string()) })),
  alavancas_ticket: z
    .array(z.object({ ideia: z.string(), ganho_estimado_por_cliente: z.string(), como_fazer: z.string() }))
    .describe("Bump, upsell, downsell, preço — com a conta do ganho"),
  criativos: z
    .array(z.object({ oferta: z.string(), angulo: z.string(), gancho: z.string().describe("3 primeiros segundos"), formato: z.string() }))
    .describe("3 a 5 criativos novos para a oferta motor"),
  regras_de_escala: z.array(z.string()).describe("Gatilhos com números desta conta: quando subir, segurar e voltar"),
  nao_fazer: z.array(z.string()),
  dados_faltando: z.array(z.string()).describe("O que limita este plano"),
});

export type Plano = z.infer<typeof PlanoSchema>;

export const ACTION_LABEL: Record<(typeof ACTIONS)[number], string> = {
  pausar: "Pausar",
  reduzir_orcamento: "Reduzir orçamento",
  aumentar_orcamento: "Aumentar orçamento",
  manter: "Manter",
  duplicar: "Duplicar",
  novo_criativo: "Novo criativo",
  ajustar_funil: "Ajustar funil",
  corrigir_tracking: "Corrigir tracking",
  aguardar: "Aguardar",
};

export const ROLE_LABEL: Record<(typeof OFFER_ROLES)[number], string> = {
  escalar: "Escalar",
  manter: "Manter",
  consertar_funil: "Consertar funil",
  cortar: "Cortar",
  testar: "Testar",
};
