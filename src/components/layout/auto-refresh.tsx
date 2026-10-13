"use client";

import { RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const INTERVAL_MS = 60_000;

/** Alguém está digitando? (não recarrega no meio de um formulário) */
function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
}

/**
 * Atualiza a tela sozinha a cada 1 minuto (relê os dados no servidor sem
 * recarregar a página nem perder o que está aberto). Pausa com a aba em
 * segundo plano, sem internet ou enquanto você digita; ao voltar para a aba,
 * atualiza na hora se passou mais de 1 minuto.
 */
export function AutoRefresh() {
  const router = useRouter();
  const last = useRef(0);
  const [ago, setAgo] = useState(0);

  useEffect(() => {
    last.current = Date.now();
    const refresh = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine || isTyping()) return;
      last.current = Date.now();
      setAgo(0);
      router.refresh();
    };
    const tick = setInterval(() => {
      const elapsed = Date.now() - last.current;
      if (elapsed >= INTERVAL_MS) refresh();
      else setAgo(Math.floor(elapsed / 1000));
    }, 5_000);
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - last.current >= INTERVAL_MS) refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(tick);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [router]);

  return (
    <span className="hidden items-center gap-1 text-[11px] text-faint sm:inline-flex" title="A tela se atualiza sozinha a cada 1 minuto. Os dados do Meta são puxados a cada 15 minutos.">
      <RefreshCw className="h-3 w-3" />
      {ago < 10 ? "atualizado agora" : `atualizado há ${ago}s`}
    </span>
  );
}
