import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropicClient } from "@/lib/advisor/generate";
import { getRepository } from "@/lib/data";
import { env } from "@/lib/env";
import { DEFAULT_MONTHLY_GOAL } from "@/lib/strategist/goal";
import { buildClaudinhoSnapshot, CLAUDINHO_SYSTEM, listPlans } from "@/lib/strategist/service";

export const maxDuration = 120;

const Body = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(30),
});

const CHAT_RULES = `Agora você está conversando com o dono da conta. Responda curto e direto (até ~200 palavras, a menos que peçam detalhe), sempre com números do JSON, na moeda certa, e termine com a próxima ação concreta. Sem markdown pesado: frases curtas e listas simples.`;

/** Chat com o Claudinho: retrato da conta inteira + último plano no system (com cache), resposta em streaming. */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Pedido inválido" }, { status: 400 });
  if (!env.anthropicApiKey) return Response.json({ error: "Configure ANTHROPIC_API_KEY para conversar com o Claudinho." }, { status: 503 });
  const { messages } = parsed.data;
  if (messages.at(-1)?.role !== "user") return Response.json({ error: "A última mensagem deve ser do usuário" }, { status: 400 });

  const repo = await getRepository();
  const last = (await listPlans(repo, 1))[0] ?? null;
  const snapshot = await buildClaudinhoSnapshot(repo, last?.goal ?? DEFAULT_MONTHLY_GOAL);

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
            { type: "text", text: `${CLAUDINHO_SYSTEM}\n\n${CHAT_RULES}` },
            {
              type: "text",
              text: `Dados da conta (JSON):\n${JSON.stringify(snapshot)}${last ? `\n\nÚltimo plano do Claudinho (${last.createdAt.slice(0, 10)}):\n${JSON.stringify(last.content)}` : ""}`,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages,
        });
        for await (const event of s) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") controller.enqueue(encoder.encode(event.delta.text));
        }
        const final = await s.finalMessage();
        if (final.stop_reason === "refusal") controller.enqueue(encoder.encode("\n\n[O Claudinho não respondeu a esta pergunta. Reformule, por favor.]"));
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
