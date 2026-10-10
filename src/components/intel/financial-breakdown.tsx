import type { Financials } from "@/lib/metrics/finance";
import { fmtBRL, fmtInt, fmtPct, fmtRoas } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Resultado financeiro com cada parcela separada. "Faturamento − tráfego" e
 * "lucro de contribuição" aparecem com nomes distintos: nenhum é lucro líquido.
 */
/** `undetermined`: há vendas sem origem que podem pertencer a esta entidade — sem cores de lucro/prejuízo. */
export function FinancialBreakdown({ fin, spendEstimated, undetermined }: { fin: Financials; spendEstimated?: boolean; undetermined?: boolean }) {
  const lines: Array<{ label: string; value: number | null; sign?: "+" | "−"; strong?: boolean; sub?: string; tone?: "good" | "bad" }> = [
    { label: "Faturamento bruto aprovado", value: fin.grossApproved, strong: true, sub: `${fmtInt(fin.mainPurchases)} compra(s) principal(is) · ticket médio ${fmtBRL(fin.avgOrderValue)}` },
    { label: "Produto principal", value: fin.mainRevenue, sub: "dentro do bruto" },
    { label: "Order bumps", value: fin.bumpRevenue, sub: `${fmtInt(fin.bumpOrders)} venda(s) — não contam como compra` },
    { label: "Upsells", value: fin.upsellRevenue, sub: `${fmtInt(fin.upsellOrders)} venda(s)` },
    { label: "Reembolsos e chargebacks", value: fin.refunds, sign: "−", sub: `${fmtInt(fin.refundCount)} pedido(s)` },
    { label: "Taxas da Cakto", value: fin.fees, sign: "−", sub: fin.feesEstimatedShare > 0 ? `estimadas (taxa padrão) em pedidos que somam ${fmtPct(fin.feesEstimatedShare, 0)} do faturamento` : "informadas pela Cakto" },
    { label: "Impostos", value: fin.taxes, sign: "−" },
    { label: "Custos variáveis do produto", value: fin.variableCosts, sign: "−", sub: fin.costsConfigured ? undefined : "há produto sem custo configurado" },
    { label: "Gasto com anúncios", value: fin.adSpend, sign: "−", sub: spendEstimated ? "convertido de outra moeda (estimado)" : undefined },
  ];
  return (
    <div className="space-y-3 text-sm">
      <div className="grid grid-cols-2 gap-2">
        <Big label="Faturamento − tráfego" value={fmtBRL(fin.grossMinusAds)} hint="Bruto menos anúncios. Não é lucro." tone={!undetermined && fin.grossMinusAds < 0 ? "bad" : undefined} />
        <Big
          label="Lucro de contribuição (estimado)"
          value={fmtBRL(fin.contribution)}
          hint={`Margem ${fmtPct(fin.contributionMargin, 1)} · sem custos fixos`}
          tone={undetermined ? undefined : fin.contribution < 0 ? "bad" : fin.contribution > 0 ? "good" : undefined}
        />
        <Big label="CPA (compra principal)" value={fmtBRL(fin.cpa)} hint={`Equilíbrio: ${fmtBRL(fin.breakevenCpa)}`} />
        <Big label="ROAS bruto" value={fmtRoas(fin.roasGross)} hint={`Equilíbrio: ${fmtRoas(fin.breakevenRoas)} · após reembolsos ${fmtRoas(fin.roasAfterRefunds)}`} />
      </div>
      <details className="rounded-lg border border-border bg-bg/40 px-3 py-2 text-xs">
        <summary className="cursor-pointer font-medium">Composição e como calculamos</summary>
        <table className="mt-2 w-full">
          <tbody>
            {lines.map((l) => (
              <tr key={l.label} className="border-t border-border align-top">
                <td className={cn("py-1 pr-2", l.strong && "font-semibold", !l.sign && !l.strong && "pl-3 text-muted")}>
                  {l.label}
                  {l.sub ? <span className="block text-[11px] text-faint">{l.sub}</span> : null}
                </td>
                <td className="py-1 text-right tabular">
                  {l.sign === "−" && l.value ? "− " : ""}
                  {fmtBRL(l.value)}
                </td>
              </tr>
            ))}
            <tr className="border-t border-border-strong font-semibold">
              <td className="py-1">= Lucro de contribuição (estimado)</td>
              <td className="py-1 text-right tabular">{fmtBRL(fin.contribution)}</td>
            </tr>
          </tbody>
        </table>
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-faint">
          <li>CPA de equilíbrio = contribuição antes de anúncios ÷ compras principais; ROAS de equilíbrio = bruto ÷ contribuição antes de anúncios.</li>
          {fin.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function Big({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "good" | "bad" }) {
  return (
    <div className="rounded-lg border border-border bg-bg/40 px-3 py-2">
      <p className="text-[11px] font-medium text-muted">{label}</p>
      <p className={cn("text-lg font-semibold tabular", tone === "good" && "text-good", tone === "bad" && "text-bad")}>{value}</p>
      {hint ? <p className="text-[11px] text-faint">{hint}</p> : null}
    </div>
  );
}
