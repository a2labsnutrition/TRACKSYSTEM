import "server-only";
import { z } from "zod";
import { structured } from "@/lib/ai/structured";
import { DISCOVER_SYSTEM } from "@/lib/discover/ai";
import { normalizeRatio, type FlowScene } from "./flow";
import type { AngleLesson } from "./learning";

export const FlowScenesSchema = z.object({
  cenas: z
    .array(
      z.object({
        titulo: z.string(),
        angulo: z.string(),
        gancho: z.string().describe("Primeira frase/legenda em português"),
        prompt: z.string().describe("Prompt visual em inglês: sujeito, ação, cenário, câmera, luz, estilo"),
        proporcao: z.string().describe("9:16, 1:1 ou 4:5"),
        duracao_s: z.number(),
      }),
    )
    .describe("6 a 10 cenas"),
});

function task(lessons: AngleLesson[], focus: string | null): string {
  const repeat = lessons.filter((l) => l.action === "repetir");
  const more = lessons.filter((l) => l.action === "testar_mais");
  const drop = lessons.filter((l) => l.action === "abandonar");
  return [
    "Crie novas cenas de vídeo para eu gerar amanhã no Google Flow (criativos de anúncio do Meta, vertical para Reels/Stories).",
    focus ? `Foco pedido: ${focus}.` : "",
    "Use o aprendizado dos criativos já testados (veredictos estatísticos do sistema):",
    JSON.stringify({
      repetir: repeat.map((l) => ({ angulo: l.angle, ganchos_que_funcionaram: l.hooks, motivo: l.why })),
      testar_mais: more.map((l) => ({ angulo: l.angle })),
      abandonar: drop.map((l) => ({ angulo: l.angle, motivo: l.why })),
    }),
    "Regras: priorize variações dos ângulos para repetir (mesmo gancho, cenário/pessoa/início diferentes); 1–2 cenas para ângulos em teste; nada dos ângulos para abandonar.",
    "Cada prompt visual em inglês, uma cena por prompt, sem texto na tela e sem marcas; sem antes/depois nem promessas de resultado.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Prompt para colar em qualquer IA grátis; a resposta volta em "Colar prompts". */
export function manualFlowPrompt(lessons: AngleLesson[], focus: string | null): string {
  return [
    DISCOVER_SYSTEM,
    "",
    "## Tarefa",
    task(lessons, focus),
    "",
    "## Formato da resposta",
    "Só a lista de prompts em inglês, um por parágrafo (separados por uma linha em branco), sem numeração nem comentários.",
  ].join("\n");
}

export async function generateFlowScenes(lessons: AngleLesson[], focus: string | null): Promise<FlowScene[]> {
  const { data } = await structured({ schema: FlowScenesSchema, system: DISCOVER_SYSTEM, maxTokens: 6000, user: task(lessons, focus) });
  return data.cenas.map((c) => ({
    title: c.titulo,
    angle: c.angulo,
    prompt: c.prompt,
    ratio: normalizeRatio(c.proporcao),
    durationS: c.duracao_s || null,
    variant: "A" as const,
    hook: c.gancho || null,
  }));
}
