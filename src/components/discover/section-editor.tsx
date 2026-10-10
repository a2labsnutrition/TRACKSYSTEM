"use client";

import { Loader2, Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { saveSectionMarkdownAction } from "@/app/(painel)/kits/actions";
import type { KitSectionKind } from "@/lib/discover/types";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Textarea } from "@/components/ui/input";

/** Exibe a seção; "Editar" abre o markdown e salva como nova versão. */
export function SectionEditor({ kitId, kind, markdown, children }: { kitId: string; kind: KitSectionKind; markdown: string; children: React.ReactNode }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(markdown);
  const [pending, setPending] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!editing) {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setText(markdown);
              setEditing(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" /> {markdown ? "Editar" : "Escrever manualmente"}
          </Button>
          {markdown ? <CopyButton text={markdown} label="Copiar texto" /> : null}
          {msg ? <span className={msg.ok ? "self-center text-xs text-good" : "self-center text-xs text-bad"}>{msg.text}</span> : null}
        </div>
        {children}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={24} className="font-mono text-xs" />
      <p className="text-[11px] text-faint">
        Markdown simples: ## título, **negrito**, listas com &quot;- &quot;. Na página de vendas, &quot;## &quot; separa seções e a linha [BOTÃO DE COMPRA] vira o botão do checkout.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={pending}
          onClick={async () => {
            setPending(true);
            const r = await saveSectionMarkdownAction(kitId, kind, text);
            setPending(false);
            setMsg({ ok: r.ok, text: r.message });
            if (r.ok) {
              setEditing(false);
              router.refresh();
            }
          }}
        >
          {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          Salvar como nova versão
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
          Cancelar
        </Button>
        {msg && !msg.ok ? <span className="text-xs text-bad">{msg.text}</span> : null}
      </div>
    </div>
  );
}
