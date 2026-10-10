import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropicClient } from "@/lib/advisor/generate";
import { CHAT_SYSTEM } from "@/lib/advisor/prompt";
import { campaignSnapshot } from "@/lib/advisor/service";
import { getRepository } from "@/lib/data";
import { env } from "@/lib/env";
import { periodFrom } from "@/lib/page";

export const maxDuration = 120;

const Body = z.object({
  campaignId: z.string().min(1).max(64),
  period: z.record(z.string(), z.string()).optional(),
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(30),
});

/**
 * Chat contextual: o retrato completo da campanha vai no system (com cache de
 * prompt) e a resposta volta em streaming de texto.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pedido inválido" }, { status: 400 });
  if (!env.anthropicApiKey) {
    return Response.json({ error: "Configure ANTHROPIC_API_KEY para conversar com o consultor." }, { status: 503 });
  }
  const { campaignId, messages, period: periodParams } = parsed.data;
  if (messages.at(-1)?.role !== "user") return Response.json({ error: "A última mensagem deve ser do usuário" }, { status: 400 });

  const repo = await getRepository();
  const ctx = await repo.context();
  const snapshot = await campaignSnapshot(repo, campaignId, periodFrom(periodParams ?? {}, ctx.workspace.timezone));
  if (!snapshot) return Response.json({ error: "Campanha não encontrada" }, { status: 404 });

  const client = anthropicClient();
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const s = client.beta.messages.stream({
          model: env.anthropicModel,
          max_tokens: 8000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "medium" },
          system: [
            { type: "text", text: CHAT_SYSTEM },
            { type: "text", text: `Dados da campanha (JSON):\n${JSON.stringify(snapshot)}`, cache_control: { type: "ephemeral" } },
          ],
          messages,
        });
        for await (const event of s) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        const final = await s.finalMessage();
        if (final.stop_reason === "refusal") controller.enqueue(encoder.encode("\n\n[O modelo não respondeu a esta pergunta. Reformule, por favor.]"));
        if (final.stop_reason === "max_tokens") controller.enqueue(encoder.encode("\n\n[Resposta cortada por tamanho.]"));
      } catch (e) {
        const msg =
          e instanceof Anthropic.RateLimitError
            ? "Limite de uso da API atingido. Tente em alguns minutos."
            : e instanceof Anthropic.AuthenticationError
              ? "Chave da Anthropic inválida."
              : e instanceof Anthropic.APIError
                ? `Erro da API (${e.status ?? "rede"}).`
                : "Erro ao gerar a resposta.";
        controller.enqueue(encoder.encode(`\n\n[${msg}]`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}
