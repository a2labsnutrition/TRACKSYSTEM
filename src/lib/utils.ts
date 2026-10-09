import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Divisão segura: retorna null quando o denominador é 0/indefinido. */
export function safeDiv(n: number | null | undefined, d: number | null | undefined): number | null {
  if (n == null || d == null || !Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}

export function sum<T>(rows: T[], pick: (r: T) => number | null | undefined): number {
  let s = 0;
  for (const r of rows) {
    const v = pick(r);
    if (v != null && Number.isFinite(v)) s += v;
  }
  return s;
}

export function groupBy<T, K extends string | number>(rows: T[], key: (r: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const r of rows) {
    const k = key(r);
    const arr = m.get(k);
    if (arr) arr.push(r);
    else m.set(k, [r]);
  }
  return m;
}

export function toNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

export function randomId(bytes = 16): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}
