import type { AttributionSplit } from "@/lib/analytics";
import { fmtInt, fmtPct } from "@/lib/format";

/** Vendas por nível de atribuição, com o número do Meta separado (nunca somados). */
export function AttributionSplitView({ split, metaPurchases }: { split: AttributionSplit; metaPurchases: number }) {
  const total = Math.max(1, split.total);
  const parts = [
    { key: "confirmada", label: "Confirmada", n: split.confirmada, cls: "bg-good", hint: "sessão no checkout (sck/src) ou IDs do Meta nas UTMs" },
    { key: "provavel", label: "Provável", n: split.provavel, cls: "bg-info", hint: "fbclid, e-mail/telefone (hash) ou único clique na janela" },
    { key: "desconhecida", label: "Desconhecida", n: split.desconhecida, cls: "bg-faint", hint: "sem origem — não é atribuída a nenhum anúncio" },
  ];
  return (
    <div className="space-y-2 text-xs">
      <div className="flex h-2.5 overflow-hidden rounded-full bg-panel-2">
        {parts.map((p) => (p.n ? <div key={p.key} className={p.cls} style={{ width: `${(p.n / total) * 100}%` }} /> : null))}
      </div>
      <ul className="space-y-1">
        {parts.map((p) => (
          <li key={p.key} className="flex items-start gap-2">
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${p.cls}`} />
            <span className="min-w-0 flex-1">
              <b>{p.label}</b> <span className="text-faint">— {p.hint}</span>
            </span>
            <span className="tabular">{fmtInt(p.n)}</span>
          </li>
        ))}
      </ul>
      <p className="text-muted">
        Cakto: <b className="tabular">{fmtInt(split.total)}</b> compra(s) principal(is) paga(s)
        {split.coverage != null ? <> · {fmtPct(split.coverage, 0)} com origem</> : null} · Meta (Pixel/CAPI, janela de atribuição do Meta):{" "}
        <b className="tabular">{fmtInt(metaPurchases)}</b>
      </p>
    </div>
  );
}
