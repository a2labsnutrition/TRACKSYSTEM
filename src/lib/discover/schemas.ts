import { z } from "zod";

/**
 * Estruturas fixas das saídas da IA no Descobrir & Criar (saída estruturada).
 * Sem restrições de tamanho no schema (a saída estruturada aceita um subconjunto
 * de JSON Schema); as quantidades ficam nas descrições e nas instruções.
 */

export const ReferenceAnalysisSchema = z.object({
  gancho: z.string().describe("O gancho dos primeiros segundos/linha, com as palavras do anúncio"),
  promessa: z.string(),
  angulo: z.string().describe("Ângulo de comunicação em poucas palavras (ex.: 'renda com doces', 'praticidade')"),
  cta: z.string(),
  tipo_pagina: z.string().describe("Tipo provável de página de destino (VSL longa, página curta, quiz, advertorial...) ou 'não informado'"),
  por_que_funciona: z.array(z.string()).describe("2 a 4 hipóteses, sem afirmar o que não dá para saber"),
  riscos_politica: z.array(z.string()).describe("Trechos ou ideias que violariam políticas do Meta se copiados; vazio se nenhum"),
  ideias_para_testar: z.array(z.string()).describe("2 a 4 ideias de teste inspiradas (sem copiar)"),
});

export const NicheSeedSchema = z.object({
  escala_estimada: z.number().describe("0–100: quão provável é haver anunciantes escalando no nicho/subnicho no Brasil hoje (estimativa)"),
  saturacao_estimada: z.number().describe("0–100: quão disputado/saturado o nicho está (estimativa)"),
  justificativa: z.string().describe("1–2 frases explicando as estimativas, deixando claro que é estimativa"),
  subnichos_em_alta: z.array(z.string()),
  angulos: z.array(z.string()).describe("5 a 8 ângulos de comunicação que costumam funcionar"),
  estruturas_oferta: z.array(z.string()).describe("3 a 5 estruturas de oferta comuns (produto + bônus + preço típico)"),
  formatos_que_mais_aparecem: z.array(z.string()),
  alertas: z.array(z.string()).describe("Riscos de política, sazonalidade ou mercado"),
});

export const PlanSchema = z.object({
  publico: z.object({
    quem: z.string(),
    dores: z.array(z.string()),
    desejos: z.array(z.string()),
    objecoes: z.array(z.string()),
  }),
  angulos: z
    .array(z.object({ nome: z.string(), ideia: z.string(), gancho_exemplo: z.string(), por_que: z.string() }))
    .describe("No mínimo 5 ângulos distintos"),
  tipo_produto: z.object({ recomendado: z.string(), alternativas: z.array(z.string()), por_que: z.string() }),
  preco: z.object({ faixa: z.string(), ancoragem: z.string(), por_que: z.string() }),
  estrutura_oferta: z.object({
    promessa: z.string(),
    mecanismo_unico: z.string(),
    bonus: z.array(z.string()),
    garantia: z.string(),
    orderbump: z.string(),
    upsell: z.string(),
  }),
  estrategia_pagina: z.object({ formato: z.string(), por_que: z.string() }),
  estrategia_criativo: z.object({ formatos: z.array(z.string()), por_que: z.string() }),
  riscos: z.array(z.string()),
  o_que_nao_sabemos: z.array(z.string()).describe("O que precisa ser validado com dados reais"),
});

export const OfferSchema = z.object({
  nome: z.string(),
  promessa_principal: z.string(),
  mecanismo: z.string(),
  estrutura_produto: z.array(z.object({ modulo: z.string(), entrega: z.string() })),
  bonus: z.array(z.object({ nome: z.string(), descricao: z.string(), por_que: z.string() })),
  garantia: z.string(),
  preco: z.object({ valor: z.string(), ancoragem: z.string(), parcelamento: z.string() }),
  orderbump: z.object({ nome: z.string(), preco: z.string(), por_que: z.string() }),
  upsell: z.object({ nome: z.string(), preco: z.string(), por_que: z.string() }),
  faq: z.array(z.object({ pergunta: z.string(), resposta: z.string() })).describe("6 a 10 objeções reais respondidas"),
});

export const LandingSchema = z.object({
  tipo_pagina: z.string(),
  paleta: z.object({ primaria: z.string(), fundo: z.string(), texto: z.string(), destaque: z.string() }).describe("Cores em hexadecimal (#RRGGBB)"),
  tipografia: z.string(),
  cta_texto: z.string(),
  secoes: z
    .array(
      z.object({
        titulo: z.string(),
        objetivo: z.string(),
        copy: z.string().describe("Texto completo da seção, pronto para publicar (markdown simples: parágrafos, **negrito**, listas com '- ')"),
        tem_botao_checkout: z.boolean(),
      }),
    )
    .describe("Seções na ordem da página (8 a 12)"),
  provas_a_coletar: z.array(z.string()).describe("Provas reais que o produtor deve juntar (nunca inventar depoimentos ou números)"),
});

const VslBlock = z.object({ tempo: z.string().describe("mm:ss–mm:ss"), bloco: z.string(), fala: z.string(), broll: z.string().describe("Sugestão de imagem/tela") });
export const VslSchema = z.object({
  longa: z.array(VslBlock).describe("Versão longa: gancho 0–5s, promessa, identificação, mecanismo, prova, oferta, garantia, escassez ética, CTA"),
  curta: z.array(VslBlock).describe("Versão de 60 a 90 segundos"),
  observacoes: z.array(z.string()),
});

export const AngleScriptsSchema = z.object({
  angulo: z.string(),
  ganchos: z.array(z.string()).describe("No mínimo 10 ganchos diferentes para este ângulo"),
  roteiros: z
    .array(
      z.object({
        formato: z.string().describe("UGC, talking head, demonstração, storytelling ou depoimento"),
        duracao_s: z.number().describe("15, 30 ou 60"),
        roteiro: z.string().describe("Roteiro com marcações de cena e fala"),
        texto_principal: z.string(),
        titulo: z.string(),
        descricao: z.string(),
        hipotese: z.string().describe("O que este criativo testa e como saber se funcionou"),
      }),
    )
    .describe("3 roteiros (15s, 30s e 60s) em formatos diferentes"),
  prompts_video: z
    .array(z.object({ cena: z.string(), prompt: z.string().describe("Prompt visual em inglês para geração de vídeo/imagem"), proporcao: z.string(), duracao_s: z.number() }))
    .describe("3 a 5 prompts de cena para gerar no Google Flow"),
});

export const ComplianceRewriteSchema = z.object({
  itens: z.array(z.object({ trecho: z.string(), problema: z.string(), reescrita: z.string() })),
  observacoes: z.array(z.string()),
});

export type PlanContent = z.infer<typeof PlanSchema>;
export type OfferContent = z.infer<typeof OfferSchema>;
export type LandingContent = z.infer<typeof LandingSchema>;
export type VslContent = z.infer<typeof VslSchema>;
export type AngleScripts = z.infer<typeof AngleScriptsSchema>;
export type ScriptsContent = { angulos: AngleScripts[] };
export type ComplianceRewrites = z.infer<typeof ComplianceRewriteSchema>;
