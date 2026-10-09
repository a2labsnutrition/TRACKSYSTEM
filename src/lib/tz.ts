/**
 * Datas "de calendário" (YYYY-MM-DD) num fuso específico.
 * Os insights diários do Meta vêm no fuso da conta de anúncios; as datas do
 * painel usam o fuso do workspace (padrão America/Cuiaba).
 */

export function todayIn(timeZone: string, now: Date = new Date()): string {
  return dateIn(now, timeZone);
}

export function dateIn(d: Date, timeZone: string): string {
  // en-CA produz YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

export function hourIn(d: Date, timeZone: string): number {
  const h = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", hour12: false }).format(d);
  return Number(h) % 24;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function isoToUtcMs(iso: string): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function diffDays(fromIso: string, toIso: string): number {
  return Math.round((isoToUtcMs(toIso) - isoToUtcMs(fromIso)) / 86400000);
}

export function eachDay(fromIso: string, toIso: string): string[] {
  const out: string[] = [];
  let cur = fromIso;
  let guard = 0;
  while (cur <= toIso && guard++ < 4000) {
    out.push(cur);
    cur = addDays(cur, 1);
  }
  return out;
}

/** Offset (minutos) de um fuso numa data — usado para avisar diferença de fusos. */
export function tzOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asUtc - at.getTime()) / 60000);
}

export function sameOffset(a: string, b: string): boolean {
  try {
    return tzOffsetMinutes(a) === tzOffsetMinutes(b);
  } catch {
    return a === b;
  }
}

export type PeriodKey = "today" | "yesterday" | "7d" | "14d" | "30d" | "custom";

export interface Period {
  key: PeriodKey;
  from: string;
  to: string;
  label: string;
  /** Período imediatamente anterior, de mesmo tamanho, para comparação. */
  prevFrom: string;
  prevTo: string;
}

export const PERIOD_LABELS: Record<PeriodKey, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  "7d": "7 dias",
  "14d": "14 dias",
  "30d": "30 dias",
  custom: "Personalizado",
};

export function resolvePeriod(
  timeZone: string,
  key: string | undefined,
  from?: string,
  to?: string,
  now: Date = new Date(),
): Period {
  const today = todayIn(timeZone, now);
  const k = (key && key in PERIOD_LABELS ? key : "7d") as PeriodKey;
  let f = today;
  let t = today;
  switch (k) {
    case "today":
      break;
    case "yesterday":
      f = t = addDays(today, -1);
      break;
    case "7d":
      f = addDays(today, -6);
      break;
    case "14d":
      f = addDays(today, -13);
      break;
    case "30d":
      f = addDays(today, -29);
      break;
    case "custom": {
      const re = /^\d{4}-\d{2}-\d{2}$/;
      if (from && to && re.test(from) && re.test(to)) {
        f = from <= to ? from : to;
        t = from <= to ? to : from;
      } else {
        f = addDays(today, -6);
      }
      break;
    }
  }
  const len = diffDays(f, t) + 1;
  return {
    key: k,
    from: f,
    to: t,
    label: PERIOD_LABELS[k],
    prevFrom: addDays(f, -len),
    prevTo: addDays(f, -1),
  };
}

/** Instante UTC (ISO) do início do dia local `iso` no fuso `timeZone`. */
export function localDayStartUtc(iso: string, timeZone: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, 12));
  const offset = tzOffsetMinutes(timeZone, guess);
  return new Date(Date.UTC(y, m - 1, d) - offset * 60000).toISOString();
}
