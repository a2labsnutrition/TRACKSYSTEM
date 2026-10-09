import { cn } from "@/lib/utils";

const TONES = {
  neutral: "bg-panel-2 text-muted border-border",
  good: "bg-good/10 text-good border-good/30",
  bad: "bg-bad/10 text-bad border-bad/30",
  warn: "bg-warn/10 text-warn border-warn/30",
  info: "bg-info/10 text-info border-info/30",
  violet: "bg-violet/10 text-violet border-violet/30",
  primary: "bg-primary/10 text-primary border-primary/30",
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = "neutral", className, ...props }: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium leading-none", TONES[tone], className)}
      {...props}
    />
  );
}
