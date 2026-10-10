import { parseBlocks, type Block, type Run } from "@/lib/pdf/blocks";
import type { PdfTheme } from "@/lib/pdf/types";

/** Prévia na tela com o mesmo leitor de blocos do PDF. */

function Runs({ runs, color }: { runs: Run[]; color: string }) {
  return (
    <>
      {runs.map((r, i) => {
        const el = r.code ? <code className="rounded bg-black/5 px-1 font-mono text-[0.85em]">{r.text}</code> : r.text;
        const styled = r.bold ? <strong>{el}</strong> : r.italic ? <em>{el}</em> : el;
        return r.href ? (
          <a key={i} href={r.href} target="_blank" rel="noopener noreferrer" style={{ color }} className="underline">
            {styled}
          </a>
        ) : (
          <span key={i}>{styled}</span>
        );
      })}
    </>
  );
}

function BlockEl({ b, t, images }: { b: Block; t: PdfTheme; images?: Map<string, string> }) {
  switch (b.type) {
    case "heading": {
      const cls = b.level === 2 ? "mt-4 mb-1.5 text-lg font-bold" : b.level === 3 ? "mt-3 mb-1 font-bold" : "mt-2 mb-1 text-sm font-bold";
      return (
        <p className={cls} style={b.level === 2 ? { color: t.primary } : undefined}>
          <Runs runs={b.runs} color={t.primary} />
        </p>
      );
    }
    case "paragraph":
      return (
        <p className="mb-2">
          <Runs runs={b.runs} color={t.primary} />
        </p>
      );
    case "list":
      return b.ordered ? (
        <ol className="mb-2 list-decimal pl-5">
          {b.items.map((it, i) => (
            <li key={i}>
              <Runs runs={it} color={t.primary} />
            </li>
          ))}
        </ol>
      ) : (
        <ul className="mb-2 list-disc pl-5">
          {b.items.map((it, i) => (
            <li key={i}>
              <Runs runs={it} color={t.primary} />
            </li>
          ))}
        </ul>
      );
    case "checklist":
      return (
        <ul className="mb-2 space-y-1">
          {b.items.map((it, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-1 inline-block h-3 w-3 shrink-0 border border-gray-500" style={it.checked ? { background: "#6b7280" } : undefined} />
              <span>
                <Runs runs={it.runs} color={t.primary} />
              </span>
            </li>
          ))}
        </ul>
      );
    case "table":
      return (
        <div className="mb-2 overflow-x-auto">
          <table className="w-full border border-gray-300 text-xs">
            <thead>
              <tr className="bg-gray-100">
                {b.header.map((c, i) => (
                  <th key={i} className="border border-gray-300 p-1 text-left">
                    <Runs runs={c} color={t.primary} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>
                  {b.header.map((_, ci) => (
                    <td key={ci} className="border border-gray-300 p-1">
                      <Runs runs={r[ci] ?? []} color={t.primary} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "callout":
      return (
        <div className="my-2 bg-gray-100 p-2" style={{ borderLeft: `3px solid ${t.accent}` }}>
          {b.label ? (
            <p className="font-bold" style={{ color: t.primary }}>
              {b.label}
            </p>
          ) : null}
          <p>
            <Runs runs={b.runs} color={t.primary} />
          </p>
        </div>
      );
    case "quote":
      return (
        <p className="my-2 border-l-2 border-gray-300 pl-2 italic text-gray-600">
          <Runs runs={b.runs} color={t.primary} />
        </p>
      );
    case "image": {
      const src = b.src.startsWith("storage:") ? images?.get(b.src.slice(8)) : b.src;
      return src ? (
        <figure className="my-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={b.alt} className="mx-auto max-h-64 object-contain" />
          {b.alt ? <figcaption className="text-center text-[11px] text-gray-500">{b.alt}</figcaption> : null}
        </figure>
      ) : (
        <p className="my-2 rounded border border-dashed border-gray-400 p-2 text-center text-xs text-gray-500">Imagem: {b.alt || b.src}</p>
      );
    }
    case "pagebreak":
      return <hr className="my-3 border-dashed border-gray-400" title="Quebra de página" />;
  }
}

export function PdfPreview({ markdown, theme, title, images }: { markdown: string; theme: PdfTheme; title?: string; images?: Map<string, string> }) {
  const blocks = parseBlocks(markdown);
  return (
    <div className="rounded-lg bg-white p-5 text-[13px] leading-relaxed text-gray-800" style={{ fontFamily: theme.font === "merriweather" ? "Georgia, serif" : "Inter, system-ui, sans-serif" }}>
      {title ? (
        <p className="mb-3 text-xl font-bold" style={{ color: theme.primary }}>
          {title}
        </p>
      ) : null}
      {blocks.length ? blocks.map((b, i) => <BlockEl key={i} b={b} t={theme} images={images} />) : <p className="text-gray-400">Capítulo vazio.</p>}
    </div>
  );
}
