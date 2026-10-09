"use client";

export default function PainelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-lg rounded-xl border border-bad/30 bg-bad/5 p-6 text-sm">
      <p className="font-semibold text-bad">Algo deu errado ao carregar esta tela.</p>
      <p className="mt-1 text-muted">{error.message}</p>
      <button type="button" onClick={reset} className="mt-4 rounded-lg border border-border-strong px-3 py-1.5 text-xs hover:bg-panel-2">
        Tentar de novo
      </button>
    </div>
  );
}
