import type { AdvisorReport } from "@/lib/data/types";

/** Pareceres do modo demo (memória do processo; somem ao reiniciar). */
const g = globalThis as unknown as { __ccAdvisorReports?: AdvisorReport[] };

export function demoReports(): AdvisorReport[] {
  g.__ccAdvisorReports ??= [];
  return g.__ccAdvisorReports;
}
