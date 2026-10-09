import { resolvePeriod, type Period } from "@/lib/tz";

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export function sp(params: Record<string, string | string[] | undefined>, key: string): string | undefined {
  const v = params[key];
  return Array.isArray(v) ? v[0] : v;
}

export function periodFrom(params: Record<string, string | string[] | undefined>, tz: string): Period {
  return resolvePeriod(tz, sp(params, "p"), sp(params, "from"), sp(params, "to"));
}

/** Mantém o período ao navegar entre telas. */
export function withPeriod(href: string, p: Period): string {
  const q = new URLSearchParams({ p: p.key });
  if (p.key === "custom") {
    q.set("from", p.from);
    q.set("to", p.to);
  }
  return `${href}${href.includes("?") ? "&" : "?"}${q.toString()}`;
}
