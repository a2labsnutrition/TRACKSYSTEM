import { slugPart } from "@/lib/discover/structure";
import type { ScriptsContent } from "@/lib/discover/schemas";

/**
 * Fluxo assistido do Google Flow (criativos).
 *
 * Não há API pública do Flow para gerar com os créditos gratuitos da interface
 * (o Veo tem API paga pelo Gemini/Vertex, com cobrança separada). Então o
 * sistema prepara os prompts, monta a fila do dia, você gera no Flow e envia o
 * arquivo de volta — o sistema dá o nome no padrão do tracking para o
 * desempenho voltar ligado ao criativo. O adaptador `FlowGenerator` fica pronto
 * para plugar uma API no futuro.
 */

export const FLOW_URL = "https://labs.google/fx/tools/flow";

/**
 * Plataformas de criação (uso assistido: o sistema copia o prompt e abre o site;
 * você gera lá e envia o arquivo de volta). Nenhuma integração simulada: só links.
 */
export interface CreationPlatform {
  id: string;
  name: string;
  url: string;
  kind: "video" | "imagem" | "video+imagem";
  note: string;
}

export const CREATION_PLATFORMS: CreationPlatform[] = [
  { id: "flow", name: "Google Flow", url: FLOW_URL, kind: "video+imagem", note: "Créditos gratuitos diários (Veo). A fila de hoje é pensada para eles." },
  { id: "higgsfield", name: "Higgsfield", url: "https://higgsfield.ai", kind: "video+imagem", note: "Vários modelos de vídeo e imagem, efeitos de câmera e UGC." },
  { id: "kling", name: "Kling", url: "https://klingai.com", kind: "video+imagem", note: "Vídeos curtos a partir de texto ou imagem." },
  { id: "runway", name: "Runway", url: "https://runwayml.com", kind: "video+imagem", note: "Geração e edição de vídeo." },
  { id: "hailuo", name: "Hailuo (MiniMax)", url: "https://hailuoai.video", kind: "video", note: "Vídeos curtos a partir de texto ou imagem." },
  { id: "midjourney", name: "Midjourney", url: "https://www.midjourney.com", kind: "imagem", note: "Imagens para anúncios estáticos e capas." },
];

export function platformById(id: string | null | undefined): CreationPlatform {
  return CREATION_PLATFORMS.find((p) => p.id === id) ?? CREATION_PLATFORMS[0];
}

export type QueueStatus = "backlog" | "todo" | "done" | "skipped";

export interface FlowScene {
  title: string;
  angle: string;
  /** Prompt visual (inglês costuma render melhor no Flow/Veo). */
  prompt: string;
  ratio: string;
  durationS: number | null;
  variant: "A" | "B";
  hook: string | null;
}

export interface FlowQueueItem extends FlowScene {
  id: string;
  kitId: string | null;
  priority: number;
  scheduledFor: string;
  status: QueueStatus;
  assetId: string | null;
  createdAt: string;
}

export interface CreativeAsset {
  id: string;
  kitId: string | null;
  storagePath: string;
  adName: string | null;
  angle: string | null;
  hook: string | null;
  metaAdId: string | null;
  createdAt: string;
}

/** Interface para uma futura API de geração (ex.: Veo pela API do Gemini). Não implementada. */
export interface FlowGenerator {
  readonly id: string;
  generate(scene: FlowScene): Promise<{ bytes: ArrayBuffer; mime: string }>;
}

const RATIOS = ["9:16", "1:1", "4:5", "16:9"];
export function normalizeRatio(v: string | null | undefined): string {
  const m = /(\d+)\s*[:x/]\s*(\d+)/.exec(v ?? "");
  const r = m ? `${m[1]}:${m[2]}` : "9:16";
  return RATIOS.includes(r) ? r : "9:16";
}

/** Texto final para colar no Flow. */
export function flowPromptText(s: Pick<FlowScene, "prompt" | "ratio" | "durationS" | "variant">): string {
  const lines = [s.prompt.trim()];
  if (s.variant === "B") lines.push("Alternate take: different camera angle (handheld close-up), different setting and lighting, same message.");
  lines.push(`Aspect ratio ${s.ratio}${s.durationS ? `, about ${s.durationS} seconds` : ""}. No on-screen text, no logos, no watermarks.`);
  return lines.join("\n\n");
}

/** Cenas a partir dos roteiros do kit (estruturado ou markdown editado), com versões A e B. */
export function scenesFromScripts(data: unknown, format: "structured" | "markdown", withB = true): FlowScene[] {
  const base: Omit<FlowScene, "variant">[] = [];
  if (format === "structured") {
    for (const a of (data as ScriptsContent)?.angulos ?? []) {
      for (const p of a.prompts_video ?? []) {
        base.push({ title: p.cena, angle: a.angulo, prompt: p.prompt, ratio: normalizeRatio(p.proporcao), durationS: p.duracao_s || null, hook: a.ganchos?.[0] ?? null });
      }
    }
  } else if (typeof data === "string") {
    let angle = "";
    let inPrompts = false;
    for (const raw of data.split("\n")) {
      const line = raw.trim();
      const ang = /^##\s+Ângulo:\s*(.+)$/i.exec(line);
      if (ang) {
        angle = ang[1].trim();
        inPrompts = false;
        continue;
      }
      if (/^###\s+/.test(line)) {
        inPrompts = /flow|prompts?/i.test(line);
        continue;
      }
      // "- **Cena** (9:16, 8s): prompt"
      const m = inPrompts ? /^[-*]\s+(?:\*\*(.+?)\*\*)?\s*(?:\(([^)]*)\))?\s*:?\s*(.+)$/.exec(line) : null;
      if (m && m[3].length > 15) {
        const dur = /(\d+)\s*s/.exec(m[2] ?? "");
        base.push({ title: m[1] ?? m[3].slice(0, 40), angle: angle || "geral", prompt: m[3], ratio: normalizeRatio(m[2]), durationS: dur ? Number(dur[1]) : null, hook: null });
      }
    }
  }
  return base.flatMap((s) => (withB ? [{ ...s, variant: "A" as const }, { ...s, variant: "B" as const }] : [{ ...s, variant: "A" as const }]));
}

/** Prompts colados manualmente: um por bloco (linha em branco) ou por item de lista. */
export function scenesFromPasted(text: string, angle: string, ratio: string): FlowScene[] {
  const blocks = text
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n|\n(?=\s*(?:[-*]|\d+[.)])\s)/)
    .map((b) => b.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
    .filter((b) => b.length > 15);
  return blocks.slice(0, 50).map((prompt, i) => ({ title: `Cena ${i + 1}`, angle: angle || "geral", prompt, ratio: normalizeRatio(ratio), durationS: null, variant: "A" as const, hook: null }));
}

/**
 * Prioridade (maior = antes). Ângulos com desempenho comprovado sobem, ângulos
 * comprovadamente ruins descem; versões A antes das B; ordem do plano desempata.
 */
export function scenePriority(s: Pick<FlowScene, "angle" | "variant">, order: number, angleScore: Map<string, number>): number {
  const perf = angleScore.get(angleKey(s.angle)) ?? 0;
  return Math.round(1000 + perf * 300 - order * 5 - (s.variant === "B" ? 2 : 0));
}

export const angleKey = (a: string | null | undefined) => slugPart(a ?? "").toLowerCase();

/** Itens para a fila de hoje: atrasados primeiro, depois o backlog por prioridade até completar a capacidade. */
export function pickToday(items: FlowQueueItem[], today: string, capacity: number): { overdue: FlowQueueItem[]; promote: FlowQueueItem[] } {
  const overdue = items.filter((i) => i.status === "todo" && i.scheduledFor < today);
  const todayTodo = items.filter((i) => i.status === "todo" && i.scheduledFor >= today);
  const slots = Math.max(0, capacity - todayTodo.length - overdue.length);
  const promote = items
    .filter((i) => i.status === "backlog")
    .sort((a, b) => b.priority - a.priority || a.createdAt.localeCompare(b.createdAt))
    .slice(0, slots);
  return { overdue, promote };
}

/**
 * Nome do anúncio no padrão do tracking: [produto]_[ângulo]_[público]_cNN_ddmm.
 * NN = próximo número livre entre os nomes existentes com o mesmo prefixo.
 */
export function nextAdName(o: { product: string; angle: string; audience?: string; date: string; existing: Array<string | null> }): string {
  const prefix = `[${slugPart(o.product || "produto")}]_${slugPart(o.angle || "geral")}_${slugPart(o.audience || "amplo")}_c`;
  let max = 0;
  for (const n of o.existing) {
    if (!n?.startsWith(prefix)) continue;
    const m = /^(\d+)/.exec(n.slice(prefix.length));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}${String(max + 1).padStart(2, "0")}_${o.date.slice(8, 10)}${o.date.slice(5, 7)}`;
}

const MIME: Record<string, string> = { mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };
export const ALLOWED_EXT = Object.keys(MIME);
export const MAX_UPLOAD_MB = 50;

export function extOf(name: string): string {
  return (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
}
export function mimeOf(path: string): string {
  return MIME[extOf(path)] ?? "application/octet-stream";
}
export function isVideo(path: string): boolean {
  return mimeOf(path).startsWith("video/");
}

/** Caminho no Storage: <workspace>/<yyyy-mm>/<adName>.<ext> (sem caracteres problemáticos). */
export function storagePathFor(workspaceId: string, adName: string, ext: string, date: string): string {
  const safe = adName.replace(/[^A-Za-z0-9_\-]/g, "");
  return `${workspaceId}/${date.slice(0, 7)}/${safe || "criativo"}-${Date.now().toString(36)}.${ext}`;
}

/** Comparação de nomes de anúncio (o Meta preserva o nome; ignoramos espaços e caixa). */
export function sameAdName(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const n = (s: string) => s.trim().toLowerCase().replace(/\s+/g, "");
  return n(a) === n(b);
}
