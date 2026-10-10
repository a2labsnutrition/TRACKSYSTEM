"use client";

import { Check, Loader2 } from "lucide-react";
import { useTransition } from "react";
import { resolveAlert } from "@/app/(painel)/alertas/actions";

export function ResolveButton({ id }: { id: string }) {
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(async () => void (await resolveAlert(id)))}
      className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted hover:bg-panel-2 hover:text-text"
    >
      {pending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
      Resolvido
    </button>
  );
}
