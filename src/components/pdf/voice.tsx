"use client";

import { Mic, MicOff } from "lucide-react";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Ditado por voz (Web Speech API, pt-BR). Funciona no Chrome e no Edge; em
 * navegadores sem suporte o botão avisa. O áudio é processado pelo serviço de
 * reconhecimento do navegador.
 */
export function VoiceButton({ onText, label = "Ditar" }: { onText: (text: string) => void; label?: string }) {
  const [on, setOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const rec = useRef<any>(null);

  const start = () => {
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) {
      setErr("Seu navegador não tem ditado por voz. Use o Chrome ou o Edge (ou o ditado do teclado do celular).");
      return;
    }
    const r = new SR();
    r.lang = "pt-BR";
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e: any) => {
      let text = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
      if (text.trim()) onText(text.trim());
    };
    r.onerror = (e: any) => {
      setErr(e?.error === "not-allowed" ? "Permita o uso do microfone para ditar." : "O ditado parou. Tente de novo.");
      setOn(false);
    };
    r.onend = () => setOn(false);
    rec.current = r;
    setErr(null);
    r.start();
    setOn(true);
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant={on ? "danger" : "secondary"}
        onClick={() => {
          if (on) {
            rec.current?.stop();
            setOn(false);
          } else start();
        }}
      >
        {on ? <MicOff className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
        {on ? "Parar ditado" : label}
      </Button>
      {on ? <span className="text-xs text-bad">● ouvindo…</span> : null}
      {err ? <span className="text-xs text-warn">{err}</span> : null}
    </span>
  );
}

/** Textarea com botão de ditado que acrescenta o texto falado. */
export function DictationTextarea({ name, defaultValue, rows = 8, placeholder }: { name: string; defaultValue?: string; rows?: number; placeholder?: string }) {
  const [v, setV] = useState(defaultValue ?? "");
  return (
    <div className="space-y-2">
      <textarea
        name={name}
        value={v}
        onChange={(e) => setV(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        className="w-full rounded-lg border border-border-strong bg-bg px-3 py-2 text-sm text-text placeholder:text-faint focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/50"
      />
      <VoiceButton onText={(t) => setV((cur) => (cur ? `${cur.trimEnd()} ${t}` : t))} />
    </div>
  );
}
