import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { env } from "@/lib/env";
import { ADVISOR_SYSTEM } from "./prompt";
import { ParecerSchema, type ParecerContent } from "./schema";
import type { Snapshot } from "./snapshot";

export class AdvisorError extends Error {}

export function anthropicClient(): Anthropic {
  if (!env.anthropicApiKey) throw new AdvisorError("ANTHROPIC_API_KEY não configurada.");
  return new Anthropic({ apiKey: env.anthropicApiKey });
}

export function advisorEffort(): "low" | "medium" | "high" | "xhigh" | "max" {
  const e = process.env.ANTHROPIC_EFFORT;
  return e === "low" || e === "medium" || e === "xhigh" || e === "max" ? e : "high";
}

/**
 * Gera o Parecer com o Claude (saída estruturada validada pelo schema Zod).
 * Fallback de recusa no servidor ativado ("default"): se o modelo recusar por
 * engano, a API reroda a mesma chamada no modelo recomendado.
 */
export async function generateWithClaude(snapshot: Snapshot): Promise<{ content: ParecerContent; model: string }> {
  const client = anthropicClient();
  try {
    const res = await client.beta.messages.parse({
      model: env.anthropicModel,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: advisorEffort(), format: betaZodOutputFormat(ParecerSchema) },
      system: [{ type: "text", text: ADVISOR_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: `Dados da campanha (JSON):\n${JSON.stringify(snapshot)}` }],
    });
    if (res.stop_reason === "refusal") {
      throw new AdvisorError("O modelo recusou gerar este parecer. Tente novamente ou use o parecer automático.");
    }
    if (res.stop_reason === "max_tokens") throw new AdvisorError("Resposta cortada por limite de tamanho. Tente novamente.");
    if (!res.parsed_output) throw new AdvisorError("A resposta da IA não veio no formato esperado.");
    return { content: res.parsed_output, model: res.model };
  } catch (e) {
    if (e instanceof AdvisorError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new AdvisorError("Chave da Anthropic inválida (ANTHROPIC_API_KEY).");
    if (e instanceof Anthropic.RateLimitError) throw new AdvisorError("Limite de uso da API da Anthropic atingido. Tente em alguns minutos.");
    if (e instanceof Anthropic.BadRequestError) throw new AdvisorError(`Requisição recusada pela API: ${e.message}`);
    if (e instanceof Anthropic.APIError) throw new AdvisorError(`Erro da API da Anthropic (${e.status ?? "rede"}): ${e.message}`);
    throw e;
  }
}
