/**
 * Cotação PTAX do Banco Central do Brasil (API pública Olinda/OData).
 * Endpoint: CotacaoMoedaPeriodo — retorna as cotações de compra/venda por boletim.
 * Usamos a cotação de VENDA do boletim de "Fechamento" (ou o último do dia).
 * Não verificado em produção a partir deste ambiente (rede restrita): o parser
 * é tolerante e, se a API falhar, o sistema usa a taxa manual da conta.
 */

const BASE = "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata";

/** "2026-10-09" -> "10-09-2026" (formato MM-DD-AAAA exigido pela API). */
function toBcbDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}-${d}-${y}`;
}

export function ptaxUrl(currency: string, from: string, to: string): string {
  const q = new URLSearchParams({
    "@moeda": `'${currency.toUpperCase()}'`,
    "@dataInicial": `'${toBcbDate(from)}'`,
    "@dataFinalCotacao": `'${toBcbDate(to)}'`,
    $format: "json",
    $select: "cotacaoVenda,dataHoraCotacao,tipoBoletim",
  });
  return `${BASE}/CotacaoMoedaPeriodo(moeda=@moeda,dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)?${q.toString()}`;
}

export interface PtaxRate {
  date: string;
  rate: number;
}

/** Converte a resposta da API em uma cotação por dia (Fechamento > último boletim). */
export function parsePtax(json: unknown): PtaxRate[] {
  const list = (json as { value?: Array<Record<string, unknown>> })?.value;
  if (!Array.isArray(list)) return [];
  const byDate = new Map<string, { rate: number; closing: boolean; at: string }>();
  for (const item of list) {
    const rate = Number(item.cotacaoVenda);
    const at = String(item.dataHoraCotacao ?? "");
    const date = at.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !(rate > 0)) continue;
    const closing = /fechamento/i.test(String(item.tipoBoletim ?? ""));
    const prev = byDate.get(date);
    if (!prev || (closing && !prev.closing) || (closing === prev.closing && at > prev.at)) byDate.set(date, { rate, closing, at });
  }
  return [...byDate.entries()].map(([date, v]) => ({ date, rate: v.rate })).sort((a, b) => a.date.localeCompare(b.date));
}

export async function fetchPtax(currency: string, from: string, to: string, fetchImpl: typeof fetch = fetch): Promise<PtaxRate[]> {
  const res = await fetchImpl(ptaxUrl(currency, from, to), { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`PTAX HTTP ${res.status}`);
  return parsePtax(await res.json());
}
