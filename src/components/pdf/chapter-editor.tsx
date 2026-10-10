"use client";

import { ArrowDown, ArrowUp, Eye, ImagePlus, Loader2, Pencil, Sparkles, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { chapterAiAction, moveChapterAction, prepareImageAction, removeChapterAction, rewriteAction, saveChapterAction } from "@/app/(painel)/pdf/actions";
import { scanText } from "@/lib/discover/compliance";
import { PAGE_BREAK } from "@/lib/pdf/blocks";
import { manualRewritePrompt } from "@/lib/pdf/prompts";
import type { PdfChapter, PdfTheme } from "@/lib/pdf/types";
import { createSupabaseBrowser } from "@/lib/supabase/browser";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Input } from "@/components/ui/input";
import { PdfPreview } from "./preview";
import { VoiceButton } from "./voice";

const SNIPPETS: Array<{ label: string; text: string }> = [
  { label: "Subtítulo", text: "\n## Subtítulo\n" },
  { label: "Lista", text: "\n- item\n- item\n" },
  { label: "Passos", text: "\n1. primeiro passo\n2. segundo passo\n" },
  { label: "Checklist", text: "\n- [ ] tarefa\n- [ ] tarefa\n" },
  { label: "Tabela", text: "\n| Coluna 1 | Coluna 2 |\n|---|---|\n| | |\n" },
  { label: "Dica", text: "\n> **Dica:** \n" },
  { label: "Atenção", text: "\n> **Atenção:** \n" },
  { label: "Exercício", text: "\n> **Exercício:** \n" },
  { label: "Citação", text: "\n> \n" },
  { label: "Quebra de página", text: `\n${PAGE_BREAK}\n` },
];

export function ChapterEditor({
  projectId,
  chapter,
  index,
  total,
  theme,
  hasAi,
  live,
  aiPrompt,
  images,
}: {
  projectId: string;
  chapter: PdfChapter;
  index: number;
  total: number;
  theme: PdfTheme;
  hasAi: boolean;
  live: boolean;
  aiPrompt: string;
  images: Map<string, string>;
}) {
  const router = useRouter();
  const ta = useRef<HTMLTextAreaElement>(null);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(chapter.title);
  const [md, setMd] = useState(chapter.markdown);
  const [preview, setPreview] = useState(false);
  const [extra, setExtra] = useState("");
  const [instr, setInstr] = useState("");
  const [sel, setSel] = useState<{ start: number; end: number } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const dirty = md !== chapter.markdown || title !== chapter.title;
  const flags = useMemo(() => scanText(md, chapter.title), [md, chapter.title]);
  const words = md.split(/\s+/).filter(Boolean).length;

  const run = async (key: string, fn: () => Promise<{ ok: boolean; message: string }>, refresh = true) => {
    setBusy(key);
    setMsg(null);
    try {
      const r = await fn();
      if (r.message) setMsg({ ok: r.ok, text: r.message });
      if (r.ok && refresh) router.refresh();
      return r;
    } finally {
      setBusy(null);
    }
  };

  const insert = (text: string) => {
    const el = ta.current;
    const start = el?.selectionStart ?? md.length;
    const end = el?.selectionEnd ?? md.length;
    const next = md.slice(0, start) + text + md.slice(end);
    setMd(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };
  const selected = sel && sel.end > sel.start ? md.slice(sel.start, sel.end) : "";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs text-faint">Capítulo {index + 1}</span>
          <span className="truncate font-medium">{chapter.title}</span>
          <Badge tone={chapter.markdown ? "good" : "neutral"}>{chapter.markdown ? `${chapter.markdown.split(/\s+/).filter(Boolean).length} palavras` : "vazio"}</Badge>
          {flags.length ? <Badge tone="warn">{flags.length} alerta(s) de política</Badge> : null}
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <Button type="button" size="sm" variant="ghost" disabled={index === 0 || !!busy} onClick={() => run("up", () => moveChapterAction(projectId, chapter.id, -1))} aria-label="Subir">
            <ArrowUp className="h-3.5 w-3.5" />
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={index === total - 1 || !!busy} onClick={() => run("down", () => moveChapterAction(projectId, chapter.id, 1))} aria-label="Descer">
            <ArrowDown className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={!!busy}
            onClick={() => confirm(`Remover o capítulo “${chapter.title}”? Ele continua nas versões anteriores.`) && run("rm", () => removeChapterAction(projectId, chapter.id))}
            aria-label="Remover capítulo"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              setTitle(chapter.title);
              setMd(chapter.markdown);
              setEditing((e) => !e);
            }}
          >
            <Pencil className="h-3.5 w-3.5" /> {editing ? "Fechar" : "Editar"}
          </Button>
        </div>
      </div>
      {chapter.summary ? <p className="text-xs text-muted">{chapter.summary}</p> : null}

      {/* Escrever o capítulo: IA integrada ou prompt para IA grátis */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-2">
        <Input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Pedido extra (ex.: mais prático, com exercícios no fim)" className="h-8 min-w-0 flex-1 text-xs" />
        <VoiceButton onText={(t) => setExtra((c) => (c ? `${c} ${t}` : t))} label="Falar" />
        {hasAi ? (
          <Button
            type="button"
            size="sm"
            disabled={!!busy}
            onClick={() => {
              if (chapter.markdown && !confirm("Reescrever o capítulo inteiro com a IA? A versão atual fica no histórico.")) return;
              void run("ai", () => chapterAiAction(projectId, chapter.id, extra || null));
            }}
          >
            {busy === "ai" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            {chapter.markdown ? "Reescrever com IA" : "Escrever com IA"}
          </Button>
        ) : null}
        <CopyButton text={extra ? `${aiPrompt}\n\nPedido extra do autor: ${extra}` : aiPrompt} label="Copiar prompt (IA grátis)" />
      </div>

      {editing ? (
        <div className="space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Título do capítulo" />
          <div className="flex flex-wrap gap-1">
            {SNIPPETS.map((s) => (
              <button key={s.label} type="button" onClick={() => insert(s.text)} className="rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:text-text">
                {s.label}
              </button>
            ))}
            <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:text-text">
              <ImagePlus className="h-3 w-3" /> Imagem
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (!f) return;
                  if (!live) {
                    insert("\n![legenda](https://link-da-imagem.png)\n");
                    setMsg({ ok: false, text: "Modo demo: troque pelo link https:// de uma imagem." });
                    return;
                  }
                  setBusy("img");
                  try {
                    const prep = await prepareImageAction(projectId, f.name, f.size);
                    if (!prep.ok || !prep.path || !prep.token || !prep.bucket) throw new Error(prep.message);
                    const up = await createSupabaseBrowser().storage.from(prep.bucket).uploadToSignedUrl(prep.path, prep.token, f, { contentType: f.type });
                    if (up.error) throw new Error(up.error.message);
                    insert(`\n![${f.name.replace(/\.[^.]+$/, "")}](storage:${prep.path})\n`);
                    setMsg({ ok: true, text: "Imagem enviada — salve o capítulo." });
                  } catch (err) {
                    setMsg({ ok: false, text: (err as Error).message });
                  } finally {
                    setBusy(null);
                  }
                }}
              />
            </label>
            <button type="button" onClick={() => setPreview((p) => !p)} className="inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 text-[11px] text-muted hover:text-text">
              <Eye className="h-3 w-3" /> {preview ? "Ocultar prévia" : "Prévia ao lado"}
            </button>
          </div>
          <div className={preview ? "grid gap-3 lg:grid-cols-2" : ""}>
            <textarea
              ref={ta}
              value={md}
              onChange={(e) => setMd(e.target.value)}
              onSelect={(e) => setSel({ start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })}
              rows={22}
              className="w-full rounded-lg border border-border-strong bg-bg px-3 py-2 font-mono text-xs leading-relaxed text-text focus:border-primary focus:outline-none"
              placeholder="Escreva aqui ou cole a resposta da IA grátis."
            />
            {preview ? (
              <div className="max-h-[560px] overflow-y-auto">
                <PdfPreview markdown={md} theme={theme} title={title} images={images} />
              </div>
            ) : null}
          </div>

          {/* Edição por comando no trecho selecionado */}
          <div className="space-y-2 rounded-lg border border-border p-2">
            <p className="text-xs text-muted">
              {selected ? `Trecho selecionado: ${selected.length} caracteres.` : "Selecione um trecho no texto para pedir uma mudança só nele (ex.: “reescreva mais curto”)."}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Input value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="O que mudar no trecho" className="h-8 min-w-0 flex-1 text-xs" />
              <VoiceButton onText={(t) => setInstr((c) => (c ? `${c} ${t}` : t))} label="Falar" />
              {hasAi ? (
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  disabled={!selected || !instr || !!busy}
                  onClick={async () => {
                    if (!sel) return;
                    const r = await run("rw", () => rewriteAction(selected, instr, title), false);
                    const text = (r as { text?: string }).text;
                    if (r.ok && text) setMd((cur) => cur.slice(0, sel.start) + text + cur.slice(sel.end));
                  }}
                >
                  {busy === "rw" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Aplicar no trecho
                </Button>
              ) : null}
              {selected && instr ? <CopyButton text={manualRewritePrompt(selected, instr, title)} label="Copiar prompt do trecho" /> : null}
            </div>
          </div>

          {flags.length ? (
            <ul className="space-y-1 rounded-lg border border-warn/30 bg-warn/5 p-2 text-xs">
              {flags.map((f, i) => (
                <li key={i}>
                  <b className="text-warn">{f.label}:</b> “{f.excerpt}” — {f.reason}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" disabled={!dirty || !!busy} onClick={() => run("save", () => saveChapterAction(projectId, chapter.id, title, md))}>
              {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
              Salvar capítulo (nova versão)
            </Button>
            <span className="text-xs text-faint">{words} palavras</span>
            {dirty ? <span className="text-xs text-warn">alterações não salvas</span> : null}
          </div>
        </div>
      ) : chapter.markdown ? (
        <details>
          <summary className="cursor-pointer text-xs text-muted">Ver prévia</summary>
          <div className="mt-2">
            <PdfPreview markdown={chapter.markdown} theme={theme} images={images} />
          </div>
        </details>
      ) : null}
      {msg ? <p className={msg.ok ? "text-xs text-good" : "text-xs text-bad"}>{msg.text}</p> : null}
    </div>
  );
}

/** Escreve, um por vez, os capítulos que estão vazios (cada um é uma chamada ao servidor). */
export function WriteAllChapters({ projectId, empty }: { projectId: string; empty: Array<{ id: string; title: string }> }) {
  const router = useRouter();
  const [state, setState] = useState<{ i: number; errors: string[] } | null>(null);
  if (!empty.length) return null;
  return (
    <div className="space-y-1">
      <Button
        type="button"
        disabled={!!state}
        onClick={async () => {
          const errors: string[] = [];
          for (let i = 0; i < empty.length; i++) {
            setState({ i, errors });
            const r = await chapterAiAction(projectId, empty[i].id, null);
            if (!r.ok) {
              errors.push(`${empty[i].title}: ${r.message}`);
              break;
            }
            router.refresh();
          }
          setState(null);
          if (errors.length) alert(errors.join("\n"));
          router.refresh();
        }}
      >
        {state ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
        {state ? `Escrevendo ${state.i + 1} de ${empty.length}: ${empty[state.i].title}…` : `Escrever com IA os ${empty.length} capítulo(s) vazio(s)`}
      </Button>
      {state ? <p className="text-xs text-muted">Leva alguns minutos — não feche a página.</p> : null}
    </div>
  );
}
