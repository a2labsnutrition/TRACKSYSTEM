import type { FlowScene } from "@/lib/creative/flow";
import { radarTag, type AiSubniche } from "./catalog";
import type { SubnicheMeasure } from "./measure";

/**
 * Banco de ganchos do radar. Origens:
 *  - youtube: título real de um vídeo em alta (inspiração — reescreva com suas palavras);
 *  - ia: gerado pela IA (ou colado da resposta de uma IA grátis);
 *  - manual: escrito por você.
 * "Enviar para Criativos" cria um item na fila do Flow com o ângulo `ia-<slug>`:
 * o anúncio nomeado pela fila carrega a etiqueta e o resultado volta para o radar.
 */

export type HookSource = "youtube" | "ia" | "manual";
export type HookStatus = "novo" | "enviado" | "descartado";

export interface RadarHook {
  id: string;
  slug: string;
  text: string;
  source: HookSource;
  /** De onde veio (canal/views do vídeo, motivo da IA). */
  reference: string | null;
  status: HookStatus;
  createdAt: string;
  sentAt: string | null;
}

export type NewHook = Pick<RadarHook, "slug" | "text" | "source" | "reference">;

export const HOOK_SOURCE_LABEL: Record<HookSource, string> = { youtube: "Título do YouTube", ia: "IA", manual: "Manual" };

const cleanLine = (l: string) =>
  l
    .replace(/^\s*(?:[-*•–]|\d+[.)-]|#+)\s*/, "")
    .replace(/^["“”'«»]+|["“”'«»]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

/** Um gancho por linha (aceita lista numerada, marcadores e aspas). */
export function parseHooks(text: string, max = 30): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const l = cleanLine(raw);
    if (l.length < 8 || l.length > 220) continue;
    const k = l.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(l);
    if (out.length >= max) break;
  }
  return out;
}

/** Remove os já existentes no banco (mesmo subnicho, mesmo texto). */
export function dedupeHooks(items: NewHook[], existing: Array<Pick<RadarHook, "slug" | "text">>): NewHook[] {
  const have = new Set(existing.map((h) => `${h.slug}|${h.text.trim().toLowerCase()}`));
  const out: NewHook[] = [];
  for (const i of items) {
    const k = `${i.slug}|${i.text.trim().toLowerCase()}`;
    if (have.has(k)) continue;
    have.add(k);
    out.push(i);
  }
  return out;
}

/** Títulos dos vídeos mais fortes da última medição viram ganchos de inspiração. */
export function hooksFromVideos(m: SubnicheMeasure, max = 5): NewHook[] {
  return m.topVideos.slice(0, max).map((v) => ({
    slug: m.slug,
    text: v.title.replace(/\s+/g, " ").trim(),
    source: "youtube" as const,
    reference: `${v.channelTitle} · ${v.viewsPerDay.toLocaleString("pt-BR")} views/dia · youtu.be/${v.id}`,
  }));
}

/** Cena para a fila de Criativos (prompt visual em inglês, gancho em português). */
export function hookScene(sub: Pick<AiSubniche, "slug" | "audience" | "promise">, hook: Pick<RadarHook, "text">): FlowScene {
  const text = hook.text.replace(/"/g, "'");
  return {
    title: hook.text.length > 60 ? `${hook.text.slice(0, 57)}...` : hook.text,
    angle: radarTag(sub.slug),
    prompt: [
      "Vertical 9:16 UGC-style smartphone video for a Brazilian audience.",
      `A relatable person (${sub.audience}) speaks directly to the camera in a natural, well-lit home or office setting, then briefly shows a phone or laptop screen using an AI assistant.`,
      `Theme: "${sub.promise}". Opening line spoken in Brazilian Portuguese: "${text}".`,
      "Handheld, authentic, warm daylight; no logos, no on-screen text, no before/after, no income claims.",
    ].join(" "),
    ratio: "9:16",
    durationS: 8,
    variant: "A",
    hook: hook.text,
  };
}

/** Pedido de ganchos (o mesmo para a IA do sistema e para colar numa IA grátis). */
export function hooksTask(sub: AiSubniche, m: SubnicheMeasure | null, existing: string[]): string {
  return [
    `Crie 10 ganchos (primeira frase de anúncio em vídeo para Reels/Stories do Meta) para o subnicho “${sub.name}”.`,
    `Público: ${sub.audience}. Promessa do produto: ${sub.promise}. Ticket: R$ ${sub.ticket.min} a R$ ${sub.ticket.max}.`,
    sub.policy.reason ? `Cuidado de política: ${sub.policy.reason}` : "",
    m?.topVideos.length
      ? `Títulos dos vídeos que mais crescem no YouTube agora sobre o tema (use só como sinal do que o público procura; não copie): ${JSON.stringify(m.topVideos.map((v) => v.title))}`
      : "",
    existing.length ? `Ganchos que já tenho (não repita): ${JSON.stringify(existing.slice(0, 30))}` : "",
    "Regras: até 15 palavras cada; português do Brasil falado; variar ângulos (curiosidade, erro comum, rapidez, antes de começar, comparação, objeção); sem promessa de renda ou resultado garantido; sem perguntar atributos pessoais de quem vê; sem números inventados.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function manualHooksPrompt(system: string, sub: AiSubniche, m: SubnicheMeasure | null, existing: string[]): string {
  return [system, "", "## Tarefa", hooksTask(sub, m, existing), "", "## Formato da resposta", "Só os ganchos, um por linha, sem numeração nem comentários."].join("\n");
}
