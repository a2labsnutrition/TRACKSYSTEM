/** Formatação pt-BR: moeda BRL, números, percentuais e datas dd/mm/aaaa. */

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const brlCompact = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
  notation: "compact",
  maximumFractionDigits: 1,
});
const int = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const dec2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const DASH = "—";

export function fmtBRL(v: number | null | undefined, opts?: { compact?: boolean }): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return opts?.compact && Math.abs(v) >= 10000 ? brlCompact.format(v) : brl.format(v);
}

export function fmtInt(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return int.format(v);
}

export function fmtDec(v: number | null | undefined, digits = 2): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  if (digits === 2) return dec2.format(v);
  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(v);
}

/** Recebe fração (0.153) e devolve "15,3%". */
export function fmtPct(v: number | null | undefined, digits = 1): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return `${fmtDec(v * 100, digits)}%`;
}

export function fmtRoas(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return `${fmtDec(v, 2)}x`;
}

/** "2026-10-09" -> "09/10/2026" */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const [y, m, d] = iso.slice(0, 10).split("-");
  if (!y || !m || !d) return iso;
  return `${d}/${m}/${y}`;
}

/** "2026-10-09" -> "09/10" */
export function fmtDayShort(iso: string): string {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
}

export function fmtDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

export function fmtRelative(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `há ${h} h`;
  return `há ${Math.round(h / 24)} dias`;
}

/** Variação relativa entre dois valores (null se base 0). */
export function delta(current: number | null, previous: number | null): number | null {
  if (current == null || previous == null || previous === 0) return null;
  return (current - previous) / Math.abs(previous);
}

const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });

/** Eixos de gráfico: 1.400 -> "1,4 mil" */
export function fmtCompact(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return DASH;
  return Math.abs(v) < 1000 ? fmtInt(v) : compact.format(v);
}
