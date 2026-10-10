"use client";

import { Loader2, Sparkles } from "lucide-react";
import { useActionState } from "react";
import { generateParecer, type ParecerState } from "@/app/(painel)/campanhas/[id]/advisor-actions";
import { Button } from "@/components/ui/button";

export function GenerateParecerForm({
  campaignId,
  period,
  hasAi,
  label = "Gerar parecer",
}: {
  campaignId: string;
  period: Record<string, string>;
  hasAi: boolean;
  label?: string;
}) {
  const [state, action, pending] = useActionState<ParecerState, FormData>(generateParecer, { ok: true, message: "" });
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="campaignId" value={campaignId} />
      {Object.entries(period).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <Button type="submit" size="sm" disabled={pending}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {pending ? (hasAi ? "O consultor está analisando (até 1–2 min)…" : "Gerando…") : label}
      </Button>
      {state.message ? <span className={`text-xs ${state.ok ? "text-muted" : "text-bad"}`}>{state.message}</span> : null}
    </form>
  );
}
