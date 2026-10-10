"use client";

import { Check, ExternalLink, Loader2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { confirmUploadAction, prepareUploadAction, renameAssetAction } from "@/app/(painel)/criativos/actions";
import { CREATION_PLATFORMS, platformById } from "@/lib/creative/flow";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";

const KEY = "cc_platform";

const listeners = new Set<() => void>();
function readPlatform(): string {
  try {
    return localStorage.getItem(KEY) ?? "flow";
  } catch {
    return "flow";
  }
}
function subscribe(cb: () => void) {
  listeners.add(cb);
  window.addEventListener("storage", cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener("storage", cb);
  };
}

/** Plataforma escolhida (lembrada neste navegador). */
function usePlatform() {
  const id = useSyncExternalStore(subscribe, readPlatform, () => "flow");
  const set = (v: string) => {
    try {
      localStorage.setItem(KEY, v);
    } catch {
      // sem localStorage
    }
    listeners.forEach((l) => l());
  };
  return [platformById(id), set] as const;
}

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/** Copia o prompt e abre a plataforma escolhida em outra aba (você gera lá). */
export function CopyAndOpen({ text }: { text: string }) {
  const [p, setP] = usePlatform();
  const [done, setDone] = useState(false);
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Select value={p.id} onChange={(e) => setP(e.target.value)} className="h-8 text-xs" aria-label="Plataforma">
        {CREATION_PLATFORMS.map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </Select>
      <Button
        type="button"
        size="sm"
        onClick={async () => {
          await copy(text);
          setDone(true);
          setTimeout(() => setDone(false), 2500);
          window.open(p.url, "_blank", "noopener,noreferrer");
        }}
      >
        {done ? <Check className="h-3.5 w-3.5" /> : <ExternalLink className="h-3.5 w-3.5" />}
        {done ? "Copiado — cole lá" : `Copiar e abrir ${p.name}`}
      </Button>
    </span>
  );
}

/** Envia o arquivo gerado direto ao Storage e registra com o nome padronizado do anúncio. */
export function Uploader({
  queueId,
  kitId,
  angle,
  hook,
  defaultProduct,
  live,
}: {
  queueId: string | null;
  kitId: string | null;
  angle: string;
  hook: string | null;
  defaultProduct: string;
  live: boolean;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [product, setProduct] = useState(defaultProduct);
  const [angleV, setAngle] = useState(angle);
  const [audience, setAudience] = useState("amplo");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!live) return <p className="text-xs text-faint">Modo demo: o envio de arquivos precisa do Supabase conectado.</p>;

  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="grid gap-2 sm:grid-cols-3">
        <Input value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Produto" aria-label="Produto" className="h-8 text-xs" />
        <Input value={angleV} onChange={(e) => setAngle(e.target.value)} placeholder="Ângulo" aria-label="Ângulo" className="h-8 text-xs" />
        <Input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="Público" aria-label="Público" className="h-8 text-xs" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          accept="video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="max-w-full text-xs file:mr-2 file:rounded-md file:border file:border-border-strong file:bg-panel-2 file:px-2 file:py-1 file:text-xs file:text-text"
        />
        <Button
          type="button"
          size="sm"
          disabled={!file || busy}
          onClick={async () => {
            if (!file) return;
            setBusy(true);
            setMsg(null);
            try {
              const prep = await prepareUploadAction({ fileName: file.name, size: file.size, product, angle: angleV, audience });
              if (!prep.ok || !prep.path || !prep.token || !prep.bucket || !prep.adName) throw new Error(prep.message || "Falha ao preparar o envio.");
              const up = await createSupabaseBrowser().storage.from(prep.bucket).uploadToSignedUrl(prep.path, prep.token, file, { contentType: file.type || undefined });
              if (up.error) throw new Error(`Falha no envio: ${up.error.message}`);
              const r = await confirmUploadAction({ path: prep.path, adName: prep.adName, angle: angleV, hook, kitId, queueId });
              setMsg({ ok: r.ok, text: r.message });
              if (r.ok) {
                setFile(null);
                router.refresh();
              }
            } catch (e) {
              setMsg({ ok: false, text: (e as Error).message });
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
          Enviar criativo
        </Button>
      </div>
      {msg ? <p className={msg.ok ? "text-xs text-good" : "text-xs text-bad"}>{msg.text}</p> : null}
    </div>
  );
}

/** Edita o nome do anúncio (se você mudou no Meta, mantenha igual aqui para o desempenho voltar). */
export function RenameAsset({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [v, setV] = useState(name);
  const [busy, setBusy] = useState(false);
  return (
    <span className="flex items-center gap-1">
      <Input value={v} onChange={(e) => setV(e.target.value)} className="h-7 font-mono text-[11px]" aria-label="Nome do anúncio" />
      {v !== name ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            await renameAssetAction(id, v);
            setBusy(false);
            router.refresh();
          }}
        >
          Salvar
        </Button>
      ) : null}
    </span>
  );
}
