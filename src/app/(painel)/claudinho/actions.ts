"use server";

import { revalidatePath } from "next/cache";
import { getRepository } from "@/lib/data";
import { DEFAULT_MONTHLY_GOAL } from "@/lib/strategist/goal";
import { generateClaudinhoPlan } from "@/lib/strategist/service";

export interface PlanState {
  ok: boolean;
  message: string;
}

function goalFrom(form: FormData): number {
  const raw = String(form.get("goal") ?? "").replace(/\./g, "").replace(",", ".");
  const n = Number(raw);
  return Number.isFinite(n) && n >= 100 && n <= 10_000_000 ? Math.round(n) : DEFAULT_MONTHLY_GOAL;
}

export async function generatePlan(_: PlanState, form: FormData): Promise<PlanState> {
  try {
    const repo = await getRepository();
    const r = await generateClaudinhoPlan(repo, goalFrom(form));
    revalidatePath("/claudinho");
    return { ok: true, message: r.warning ?? (r.usedAi ? "Plano do Claudinho pronto." : "Plano automático gerado.") };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
