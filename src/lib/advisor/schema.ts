import { z } from "zod";

/**
 * Estrutura FIXA do Parecer do Consultor (seção 3.4 do escopo).
 * Usada como saída estruturada da API do Claude e para validar o que está salvo.
 * Sem restrições de tamanho no schema (a saída estruturada aceita um subconjunto
 * de JSON Schema); os limites ficam nas instruções.
 */

export const VERDICTS = ["escalar", "manter", "otimizar", "pausar", "aguardar"] as const;
export const BOTTLENECKS = ["criativo", "pagina", "checkout_pagamento", "publico_saturacao", "oferta_preco", "tracking", "nenhum"] as const;

export const ParecerSchema = z.object({
  veredito: z.object({
    status: z.enum(VERDICTS),
    confianca: z.enum(["baixa", "media", "alta"]),
    justificativa: z.string().describe("1-2 frases citando os números que sustentam o veredito"),
    concorda_com_regras: z.boolean().describe("true se o veredito é o mesmo do motor de regras"),
  }),
  diagnostico: z.array(z.string()).describe("Exatamente 3 linhas: o que está acontecendo e a causa mais provável, com números"),
  gargalo: z.object({
    area: z.enum(BOTTLENECKS),
    explicacao: z.string(),
  }),
  plano: z
    .array(
      z.object({
        quando: z.string().describe('Ex.: "Hoje", "Dia 2", "Dias 3-4"'),
        acao: z.string().describe("Ação concreta, com números (orçamento, %, CPA limite, quais anúncios)"),
        condicao: z.string().nullable().describe('Condição para executar, ex.: "se CPA 3d < R$ 45"'),
      }),
    )
    .describe("Plano para os próximos 3 a 7 dias, passo a passo"),
  testes: z.array(
    z.object({
      hipotese: z.string(),
      o_que_mudar: z.string(),
      metrica_sucesso: z.string(),
      orcamento: z.string(),
      prazo: z.string(),
    }),
  ),
  riscos: z.array(z.string()),
  nao_mexer: z.array(z.string()).describe("O que NÃO mexer agora e por quê"),
  caminhos: z
    .array(
      z.object({
        nome: z.string(),
        descricao: z.string(),
        pros: z.array(z.string()),
        contras: z.array(z.string()),
      }),
    )
    .describe("3 caminhos alternativos"),
  proximos_criativos: z
    .array(
      z.object({
        angulo: z.string(),
        gancho: z.string().describe("Frase/ideia dos 3 primeiros segundos"),
        motivo: z.string(),
      }),
    )
    .describe("Criativos a produzir em seguida (repetir o que funciona, abandonar o que não)"),
  alerta_tracking: z.string().nullable().describe("Preencha se o tracking não for confiável; senão null"),
});

export type ParecerContent = z.infer<typeof ParecerSchema>;

export const BOTTLENECK_LABEL: Record<(typeof BOTTLENECKS)[number], string> = {
  criativo: "Criativo (gancho, retenção, CTR)",
  pagina: "Página (carregamento, conversão)",
  checkout_pagamento: "Checkout / pagamento",
  publico_saturacao: "Público / saturação",
  oferta_preco: "Oferta / preço",
  tracking: "Tracking",
  nenhum: "Sem gargalo claro",
};
