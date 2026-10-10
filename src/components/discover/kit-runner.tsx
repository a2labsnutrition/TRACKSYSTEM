"use client";

import { CheckCircle2, Circle, Loader2, Sparkles, XCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { generateSectionAction } from "@/app/(painel)/kits/actions";
import { SECTION_LABEL, SECTION_ORDER, type KitSectionKind } from "@/lib/discover/types";
import { Button } from "@/components/ui/button";

const AI_KINDS: KitSectionKind[] = ["plan", "offer", "landing", "vsl", "scripts"];

type Step = { kind: KitSectionKind; state: "idle" | "running" | "done" | "error"; message?: string };

/**
 * "Criar tudo": gera as seções que faltam, uma por vez e na ordem (cada uma é uma
 * chamada separada ao servidor, dentro do limite de tempo da Vercel).
 */
export function KitRunner({ kitId, existing, hasAi, autoStart }: { kitId: string; existing: KitSectionKind[]; hasAi: boolean; autoStart: boolean }) {
  const router = useRouter();
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [running, setRunning] = useState(false);
  const [, startTransition] = useTransition();
  const started = useRef(false);

  const missing = SECTION_ORDER.filter((k) => !existing.includes(k) && (hasAi || !AI_KINDS.includes(k)));

  async function run(kinds: KitSectionKind[]) {
    if (!kinds.length) return;
    setRunning(true);
    const list: Step[] = kinds.map((kind) => ({ kind, state: "idle" }));
    setSteps([...list]);
    for (let i = 0; i < list.length; i++) {
      list[i] = { ...list[i], state: "running" };
      setSteps([...list]);
      const r = await generateSectionAction(kitId, list[i].kind);
      list[i] = { ...list[i], state: r.ok ? "done" : "error", message: r.message };
      setSteps([...list]);
      startTransition(() => router.refresh());
      if (!r.ok) break;
    }
    setRunning(false);
  }

  useEffect(() => {
    if (autoStart && !started.current && existing.length === 0 && hasAi) {
      started.current = true;
      router.replace(`/kits/${kitId}`, { scroll: false });
      void run(SECTION_ORDER);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {!hasAi && !missing.length ? null : (
        <Button type="button" onClick={() => run(missing)} disabled={running || !missing.length}>
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {missing.length ? `Criar tudo (${missing.length} ${missing.length > 1 ? "seções" : "seção"})` : "Kit completo"}
        </Button>
        )}
        {!hasAi ? (
          <span className="text-xs text-muted">
            Sem IA integrada: em cada seção, use <b>Copiar prompt</b> → cole no ChatGPT, Claude.ai ou Gemini → copie a resposta → <b>Colar resposta</b>. Faça na ordem (plano primeiro): os
            próximos prompts levam o plano e a oferta salvos.
          </span>
        ) : null}
        {running ? <span className="text-xs text-muted">Pode levar alguns minutos — não feche a página.</span> : null}
      </div>
      {steps ? (
        <ol className="space-y-1 text-xs">
          {steps.map((s) => (
            <li key={s.kind} className="flex items-start gap-2">
              {s.state === "running" ? (
                <Loader2 className="mt-px h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
              ) : s.state === "done" ? (
                <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0 text-good" />
              ) : s.state === "error" ? (
                <XCircle className="mt-px h-3.5 w-3.5 shrink-0 text-bad" />
              ) : (
                <Circle className="mt-px h-3.5 w-3.5 shrink-0 text-faint" />
              )}
              <span className={s.state === "error" ? "text-bad" : "text-muted"}>
                {SECTION_LABEL[s.kind]}
                {s.message ? ` — ${s.message}` : ""}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

/** Gerar/refazer uma seção. */
export function SectionGenerate({ kitId, kind, exists, disabled, disabledReason }: { kitId: string; kind: KitSectionKind; exists: boolean; disabled?: boolean; disabledReason?: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        disabled={pending || disabled}
        title={disabled ? disabledReason : undefined}
        onClick={async () => {
          if (exists && !confirm(`Gerar uma nova versão de "${SECTION_LABEL[kind]}"? A versão atual continua no histórico.`)) return;
          setPending(true);
          setMsg(null);
          const r = await generateSectionAction(kitId, kind);
          setPending(false);
          setMsg({ ok: r.ok, text: r.message });
          router.refresh();
        }}
      >
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {exists ? (kind === "structure" || kind === "compliance" ? "Recalcular" : "Nova versão") : "Gerar"}
      </Button>
      {msg ? <span className={msg.ok ? "text-xs text-good" : "text-xs text-bad"}>{msg.text}</span> : null}
    </span>
  );
}
