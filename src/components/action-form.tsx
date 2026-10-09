"use client";

import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useActionState, useState, useTransition } from "react";
import type { ActionState } from "@/app/(painel)/conexoes/actions";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

type FormAction = (prev: ActionState, form: FormData) => Promise<ActionState>;

export function Feedback({ state }: { state: ActionState | null }) {
  if (!state?.message) return null;
  return (
    <p className={cn("flex items-start gap-1.5 text-xs", state.ok ? "text-good" : "text-bad")}>
      {state.ok ? <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" /> : <XCircle className="mt-px h-3.5 w-3.5 shrink-0" />}
      {state.message}
    </p>
  );
}

/** Formulário ligado a uma server action, com feedback em português. */
export function ActionForm({
  action,
  submitLabel,
  children,
  disabled,
  disabledReason,
  className,
  variant = "primary",
}: {
  action: FormAction;
  submitLabel: string;
  children?: React.ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  className?: string;
  variant?: "primary" | "secondary";
}) {
  const [state, formAction, pending] = useActionState<ActionState, FormData>(action, { ok: true, message: "" });
  return (
    <form action={formAction} className={cn("space-y-3", className)}>
      <fieldset disabled={disabled || pending} className="space-y-3">
        {children}
        <Button type="submit" size="sm" variant={variant}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {submitLabel}
        </Button>
      </fieldset>
      {disabled && disabledReason ? <p className="text-xs text-faint">{disabledReason}</p> : null}
      <Feedback state={state} />
    </form>
  );
}

/** Botão para server actions sem parâmetros (testar, sincronizar...). */
export function ActionButton({
  action,
  label,
  disabled,
  variant = "secondary",
}: {
  action: () => Promise<ActionState>;
  label: string;
  disabled?: boolean;
  variant?: "primary" | "secondary";
}) {
  const [state, setState] = useState<ActionState | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <Button type="button" size="sm" variant={variant} disabled={disabled || pending} onClick={() => start(async () => setState(await action()))}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {label}
      </Button>
      <Feedback state={state} />
    </div>
  );
}
