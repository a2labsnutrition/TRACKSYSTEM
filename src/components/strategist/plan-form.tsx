"use client";

import { Loader2, Rocket } from "lucide-react";
import { useActionState } from "react";
import { generatePlan, type PlanState } from "@/app/(painel)/claudinho/actions";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";

export function PlanForm({ goal, hasAi, prompt, label }: { goal: number; hasAi: boolean; prompt: string; label: string }) {
  const [state, action, pending] = useActionState<PlanState, FormData>(generatePlan, { ok: true, message: "" });
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs text-muted">
        Meta líquida do mês (R$)
        <Input name="goal" defaultValue={goal.toLocaleString("pt-BR")} inputMode="numeric" className="h-8 w-28" />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
        {pending ? (hasAi ? "O Claudinho está analisando a conta (1–3 min)…" : "Gerando…") : label}
      </Button>
      <CopyButton text={prompt} label="Copiar prompt (IA grátis)" />
      {state.message ? <span className={`w-full text-xs ${state.ok ? "text-muted" : "text-bad"}`}>{state.message}</span> : null}
    </form>
  );
}
