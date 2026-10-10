import { VERDICT_LABEL, type CreativeVerdict } from "@/lib/creative/intelligence";
import { angleKey } from "./flow";

/**
 * Ciclo de aprendizado: o desempenho de cada criativo enviado (ligado ao anúncio
 * do Meta pelo nome) vira um placar por ângulo. Usa os MESMOS veredictos da
 * inteligência de criativos (teste estatístico contra o restante da campanha) —
 * nada de "vencedor" só porque o Meta gastou mais nele.
 */

export interface LearnedCreative {
  assetId: string;
  adName: string;
  angle: string;
  hook: string | null;
  campaignName: string;
  verdict: CreativeVerdict;
  reasons: string[];
  spend: number;
  purchases: number;
}

export const VERDICT_WEIGHT: Record<CreativeVerdict, number> = {
  destaque_comprovado: 2,
  sinal_positivo: 1,
  inconclusivo: 0,
  pouco_gasto: 0,
  gasto_sem_venda: -1,
  abaixo_comprovado: -2,
};

export interface AngleLesson {
  angle: string;
  score: number;
  creatives: number;
  action: "repetir" | "testar_mais" | "abandonar";
  why: string;
  hooks: string[];
}

export function angleLessons(items: LearnedCreative[]): { lessons: AngleLesson[]; scores: Map<string, number> } {
  const by = new Map<string, LearnedCreative[]>();
  for (const i of items) {
    const k = angleKey(i.angle);
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(i);
  }
  const lessons: AngleLesson[] = [];
  const scores = new Map<string, number>();
  for (const [k, list] of by) {
    const raw = list.reduce((s, i) => s + VERDICT_WEIGHT[i.verdict], 0);
    const score = Math.max(-2, Math.min(2, raw));
    scores.set(k, score);
    const proven = list.filter((i) => i.verdict === "destaque_comprovado");
    const bad = list.filter((i) => i.verdict === "abaixo_comprovado" || i.verdict === "gasto_sem_venda");
    const count = (v: CreativeVerdict) => list.filter((i) => i.verdict === v).length;
    const summary = (Object.keys(VERDICT_WEIGHT) as CreativeVerdict[])
      .filter((v) => count(v))
      .map((v) => `${count(v)}× ${VERDICT_LABEL[v].toLowerCase()}`)
      .join(", ");
    const action: AngleLesson["action"] = score >= 1 && (proven.length || list.length >= 2) ? "repetir" : score <= -1.5 && bad.length >= 2 ? "abandonar" : "testar_mais";
    lessons.push({
      angle: list[0].angle,
      score,
      creatives: list.length,
      action,
      why:
        action === "repetir"
          ? `Resultado acima do restante: ${summary}. Produza variações do mesmo gancho (outro cenário, outra pessoa, outro início).`
          : action === "abandonar"
            ? `Abaixo do restante em mais de um criativo: ${summary}. Pare de produzir este ângulo e use os créditos em outro.`
            : `Ainda sem diferença comprovada: ${summary}. Produza mais 1–2 variações antes de concluir.`,
      hooks: [...new Set(list.filter((i) => VERDICT_WEIGHT[i.verdict] > 0 && i.hook).map((i) => i.hook!))].slice(0, 5),
    });
  }
  lessons.sort((a, b) => b.score - a.score);
  return { lessons, scores };
}
