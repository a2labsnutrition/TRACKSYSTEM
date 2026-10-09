import { cn } from "@/lib/utils";

export type Light = "ok" | "warning" | "error" | "missing";

const COLORS: Record<Light, string> = {
  ok: "bg-good shadow-[0_0_0_3px] shadow-good/20",
  warning: "bg-warn shadow-[0_0_0_3px] shadow-warn/20",
  error: "bg-bad shadow-[0_0_0_3px] shadow-bad/20",
  missing: "bg-faint",
};

export const LIGHT_LABEL: Record<Light, string> = { ok: "OK", warning: "Atenção", error: "Erro", missing: "Não configurado" };

export function StatusDot({ status, className }: { status: Light; className?: string }) {
  return <span className={cn("inline-block h-2.5 w-2.5 shrink-0 rounded-full", COLORS[status], className)} />;
}
