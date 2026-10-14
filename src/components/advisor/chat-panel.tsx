"use client";

import { Loader2, MessageSquare, Send, X } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "Posso aumentar o orçamento amanhã?",
  "Qual anúncio devo pausar?",
  "Por que o CPA subiu nos últimos dias?",
  "Que público está queimando dinheiro?",
];

/** "Perguntar ao consultor": chat com todos os dados desta campanha (ou da conta, no Claudinho). */
export function ChatPanel({
  campaignId,
  period,
  enabled,
  endpoint = "/api/advisor/chat",
  title = "Perguntar ao consultor",
  subtitle = "Responde com os dados desta campanha",
  placeholder = "Pergunte sobre esta campanha…",
  suggestions = SUGGESTIONS,
  buttonVariant = "secondary",
}: {
  campaignId?: string;
  period?: Record<string, string>;
  enabled: boolean;
  endpoint?: string;
  title?: string;
  subtitle?: string;
  placeholder?: string;
  suggestions?: string[];
  buttonVariant?: "primary" | "secondary";
}) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    const next: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs([...next, { role: "assistant", content: "" }]);
    setInput("");
    setBusy(true);
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ campaignId, period, messages: next.slice(-20) }),
      });
      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        setMsgs([...next, { role: "assistant", content: `⚠ ${err.error}` }]);
        return;
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMsgs([...next, { role: "assistant", content: acc }]);
        endRef.current?.scrollIntoView({ block: "end" });
      }
    } catch (e) {
      setMsgs([...next, { role: "assistant", content: `⚠ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button type="button" variant={buttonVariant} size="sm" onClick={() => setOpen(true)}>
        <MessageSquare className="h-3.5 w-3.5" /> {title}
      </Button>
      {open ? (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className="relative flex h-full w-full max-w-md flex-col border-l border-border bg-panel">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-semibold">{title}</p>
                <p className="text-[11px] text-faint">{subtitle}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="rounded p-1 text-muted hover:text-text" aria-label="Fechar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {!enabled ? (
                <p className="rounded-lg border border-warn/30 bg-warn/5 p-3 text-xs text-warn">Configure ANTHROPIC_API_KEY no servidor para usar o chat.</p>
              ) : null}
              {!msgs.length && enabled ? (
                <div className="space-y-2">
                  <p className="text-xs text-muted">Sugestões:</p>
                  {suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => send(s)} className="block w-full rounded-lg border border-border px-3 py-2 text-left text-sm hover:bg-panel-2">
                      {s}
                    </button>
                  ))}
                </div>
              ) : null}
              {msgs.map((m, i) => (
                <div key={i} className={cn("whitespace-pre-wrap rounded-lg px-3 py-2 text-sm", m.role === "user" ? "ml-8 bg-primary/15" : "mr-4 bg-panel-2")}>
                  {m.content || (busy && i === msgs.length - 1 ? <Loader2 className="h-4 w-4 animate-spin text-muted" /> : "")}
                </div>
              ))}
              <div ref={endRef} />
            </div>
            <form
              className="flex gap-2 border-t border-border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={!enabled || busy}
                placeholder={placeholder}
                className="h-9 min-w-0 flex-1 rounded-lg border border-border-strong bg-bg px-3 text-sm focus:border-primary focus:outline-none"
                maxLength={4000}
              />
              <Button type="submit" size="sm" disabled={!enabled || busy || !input.trim()} aria-label="Enviar">
                <Send className="h-3.5 w-3.5" />
              </Button>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
