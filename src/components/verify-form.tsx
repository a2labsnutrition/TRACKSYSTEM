"use client";

import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { useActionState } from "react";
import { verifySite, type ActionState } from "@/app/(painel)/conexoes/actions";
import { cn } from "@/lib/utils";
import { Feedback } from "./action-form";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function VerifyForm({ siteKey, pixelId, defaultUrl }: { siteKey: string; pixelId: string | null; defaultUrl?: string }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(verifySite, { ok: true, message: "" });
  const v = state.verify;
  return (
    <div className="space-y-3">
      <form action={action} className="flex flex-wrap gap-2">
        <input type="hidden" name="siteKey" value={siteKey} />
        <input type="hidden" name="pixelId" value={pixelId ?? ""} />
        <Input name="url" placeholder="https://suapagina.com/oferta" defaultValue={defaultUrl} className="min-w-60 flex-1" />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          {pending ? "Verificando (até 30 s)…" : "Verificar instalação"}
        </Button>
      </form>
      {!v ? <Feedback state={state} /> : null}
      {v ? (
        <div className="rounded-lg border border-border bg-bg/40 p-3">
          <p className="mb-2 text-xs text-muted">
            {v.url} · modo {v.mode === "browser" ? "navegador (vê páginas React/Lovable)" : "HTML estático"}
          </p>
          <ul className="space-y-1.5">
            {v.checks.map((c) => {
              const Icon = c.status === "ok" ? CheckCircle2 : c.status === "warning" ? AlertTriangle : XCircle;
              return (
                <li key={c.key} className="flex gap-2 text-sm">
                  <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", c.status === "ok" ? "text-good" : c.status === "warning" ? "text-warn" : "text-bad")} />
                  <span>
                    <b>{c.label}:</b> <span className="text-muted">{c.detail}</span>
                  </span>
                </li>
              );
            })}
          </ul>
          {v.checkoutButtons.length ? (
            <div className="mt-3">
              <p className="mb-1 text-xs font-medium text-muted">Botões de checkout encontrados</p>
              <ul className="space-y-1 text-xs">
                {v.checkoutButtons.slice(0, 10).map((b, i) => (
                  <li key={i} className="truncate">
                    <span className="font-medium">{b.text}</span> <span className="text-faint">· {b.via} · {b.href}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {v.notes.map((n, i) => (
            <p key={i} className="mt-2 text-xs text-faint">{n}</p>
          ))}
        </div>
      ) : null}
    </div>
  );
}
