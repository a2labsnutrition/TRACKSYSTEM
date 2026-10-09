"use client";

import { useActionState } from "react";
import { addNote, type ActionState } from "@/app/(painel)/campanhas/[id]/actions";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function NoteForm({ campaignId, today, disabled }: { campaignId: string; today: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(addNote, { ok: true, message: "" });
  return (
    <form action={action} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="campaignId" value={campaignId} />
      <Input type="date" name="date" defaultValue={today} className="w-40" disabled={disabled} />
      <Input name="text" placeholder="Ex.: aumentei orçamento 20%, troquei o criativo B..." className="min-w-56 flex-1" disabled={disabled} maxLength={1000} />
      <Button type="submit" size="sm" disabled={disabled || pending}>
        {pending ? "Salvando..." : "Anotar ação"}
      </Button>
      {state.message ? <p className={`w-full text-xs ${state.ok ? "text-good" : "text-bad"}`}>{state.message}</p> : null}
      {disabled ? <p className="w-full text-xs text-faint">Anotações ficam disponíveis com dados reais (fora do modo demo).</p> : null}
    </form>
  );
}
