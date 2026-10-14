"use client";

import {
  Activity,
  Bell,
  Bot,
  BarChart3,
  CalendarDays,
  Compass,
  FileText,
  History,
  Film,
  Layers,
  LayoutDashboard,
  Megaphone,
  Menu,
  Plug,
  Radar,
  Receipt,
  Settings,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/utils";

const MAIN = [
  { href: "/", label: "Visão geral", icon: LayoutDashboard },
  { href: "/claudinho", label: "Claudinho (estrategista)", icon: Bot },
  { href: "/gasto-diario", label: "Gasto por dia", icon: CalendarDays },
  { href: "/campanhas", label: "Campanhas", icon: Megaphone },
  { href: "/vendas", label: "Vendas", icon: Receipt },
  { href: "/alertas", label: "Alertas", icon: Bell },
  { href: "/pareceres", label: "Acerto dos pareceres", icon: History },
  { href: "/saude", label: "Saúde do tracking", icon: Activity },
  { href: "/descobrir", label: "Descobrir & Criar", icon: Compass },
  { href: "/radar-ia", label: "Radar de Nichos de IA", icon: Radar },
  { href: "/kits", label: "Kits de campanha", icon: Layers },
  { href: "/criativos", label: "Criativos", icon: Film },
  { href: "/pdf", label: "Estúdio de PDF", icon: FileText },
  { href: "/conexoes", label: "Conexões", icon: Plug },
  { href: "/configuracoes", label: "Configurações", icon: Settings },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 p-3">
      {MAIN.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
              active ? "bg-primary/15 font-medium text-text" : "text-muted hover:bg-panel-2 hover:text-text",
            )}
          >
            <Icon className={cn("h-4 w-4", active ? "text-primary" : "")} />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-5 py-4">
      <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/20 text-primary">
        <BarChart3 className="h-4 w-4" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-semibold">Central de Comando</span>
        <span className="block text-[10px] uppercase tracking-wider text-faint">Meta Ads</span>
      </span>
    </Link>
  );
}

export function Sidebar() {
  return (
    <aside className="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-border bg-panel lg:flex">
      <Brand />
      <div className="flex-1 overflow-y-auto">
        <NavList />
      </div>
    </aside>
  );
}

export function MobileNav() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="rounded-lg p-2 text-muted hover:bg-panel-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menu">
        <Menu className="h-5 w-5" />
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 overflow-y-auto border-r border-border bg-panel">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-muted" aria-label="Fechar menu">
                <X className="h-5 w-5" />
              </button>
            </div>
            <NavList onNavigate={() => setOpen(false)} />
          </div>
        </div>
      ) : null}
    </>
  );
}
