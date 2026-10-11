import "server-only";
import { z } from "zod";
import { structured } from "@/lib/ai/structured";
import { DISCOVER_SYSTEM } from "@/lib/discover/ai";
import type { AiSubniche } from "./catalog";
import { hooksTask, manualHooksPrompt, type NewHook } from "./hooks";
import type { SubnicheMeasure } from "./measure";

const HooksSchema = z.object({
  ganchos: z
    .array(z.object({ texto: z.string().describe("Gancho em português, até 15 palavras"), angulo: z.string().describe("Ângulo em 1–3 palavras") }))
    .describe("10 ganchos"),
});

export async function generateHooks(sub: AiSubniche, m: SubnicheMeasure | null, existing: string[]): Promise<NewHook[]> {
  const { data } = await structured({ schema: HooksSchema, system: DISCOVER_SYSTEM, maxTokens: 3000, user: hooksTask(sub, m, existing) });
  return data.ganchos.map((g) => ({ slug: sub.slug, text: g.texto.trim(), source: "ia" as const, reference: g.angulo.trim() || null })).filter((h) => h.text.length >= 8);
}

/** Prompt para colar numa IA grátis; a resposta volta em “Colar ganchos”. */
export function freeHooksPrompt(sub: AiSubniche, m: SubnicheMeasure | null, existing: string[]): string {
  return manualHooksPrompt(DISCOVER_SYSTEM, sub, m, existing);
}
