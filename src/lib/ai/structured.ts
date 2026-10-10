import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { env } from "@/lib/env";

export class AiError extends Error {}

export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export function hasAi(): boolean {
  return Boolean(env.anthropicApiKey);
}

/** Esforço para geração de conteúdo (kits): ANTHROPIC_EFFORT_KIT ou "medium" (mais rápido que o parecer). */
export function kitEffort(): Effort {
  const e = process.env.ANTHROPIC_EFFORT_KIT;
  return e === "low" || e === "high" || e === "xhigh" || e === "max" ? e : "medium";
}

/**
 * Uma chamada ao Claude com saída estruturada validada por schema Zod.
 * Fallback de recusa no servidor ativado ("default"). Erros viram mensagens em pt-BR.
 * O timeout explícito respeita o limite da função na Vercel (300 s).
 */
export async function structured<S extends z.ZodType>(opts: {
  schema: S;
  system: string;
  user: string;
  maxTokens?: number;
  effort?: Effort;
  timeoutMs?: number;
  /** Imagens (base64) enviadas antes do texto — ex.: miniaturas dos anúncios. */
  images?: Array<{ mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string }>;
}): Promise<{ data: z.infer<S>; model: string }> {
  if (!env.anthropicApiKey) throw new AiError("Configure ANTHROPIC_API_KEY na Vercel para usar a geração com IA.");
  const client = new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: 1 });
  try {
    const res = await client.beta.messages.parse(
      {
        model: env.anthropicModel,
        max_tokens: opts.maxTokens ?? 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: opts.effort ?? kitEffort(), format: betaZodOutputFormat(opts.schema) },
        system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: opts.images?.length
              ? [
                  ...opts.images.map((im) => ({ type: "image" as const, source: { type: "base64" as const, media_type: im.mediaType, data: im.data } })),
                  { type: "text" as const, text: opts.user },
                ]
              : opts.user,
          },
        ],
      },
      { timeout: opts.timeoutMs ?? 280_000 },
    );
    if (res.stop_reason === "refusal") throw new AiError("O modelo recusou este pedido. Reformule o briefing (evite promessas de resultado) e tente de novo.");
    if (res.stop_reason === "max_tokens") throw new AiError("A resposta ficou grande demais e foi cortada. Tente de novo ou gere a seção sozinha.");
    if (!res.parsed_output) throw new AiError("A resposta da IA não veio no formato esperado. Tente de novo.");
    return { data: res.parsed_output as z.infer<S>, model: res.model };
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AiError("Chave da Anthropic inválida (ANTHROPIC_API_KEY).");
    if (e instanceof Anthropic.RateLimitError) throw new AiError("Limite de uso da API da Anthropic atingido. Tente em alguns minutos.");
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new AiError("A IA demorou demais para responder. Tente de novo (ou gere uma seção por vez).");
    if (e instanceof Anthropic.BadRequestError) throw new AiError(`Requisição recusada pela API: ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new AiError(`Erro da API da Anthropic (${e.status ?? "rede"}): ${e.message}`);
    throw e;
  }
}
