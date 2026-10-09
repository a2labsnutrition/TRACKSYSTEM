"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

const PLATFORMS: Array<{ key: string; label: string; steps: string[] }> = [
  {
    key: "lovable",
    label: "Lovable",
    steps: [
      "No chat do projeto, peça: “Adicione este script dentro do <head> do index.html, exatamente como está:” e cole o snippet.",
      "Peça também: “Todos os botões de compra devem ser links <a> com href do checkout da Cakto e o atributo data-track=\"checkout\".”",
      "Publique (Publish/Update) e use o Verificador abaixo com a URL publicada.",
    ],
  },
  {
    key: "wordpress",
    label: "WordPress",
    steps: [
      "Instale o plugin gratuito “WPCode” (Insert Headers and Footers).",
      "WPCode → Header & Footer → cole o snippet em “Header” e salve.",
      "Se usar cache (WP Rocket, LiteSpeed), limpe o cache e verifique abaixo.",
    ],
  },
  {
    key: "elementor",
    label: "Elementor",
    steps: [
      "Elementor → Custom Code → Add New.",
      "Cole o snippet, Location = <head>, Priority = 1, condição “Entire Site”.",
      "Publique e verifique.",
    ],
  },
  {
    key: "html",
    label: "HTML / Next / outros",
    steps: [
      "Cole o snippet antes de </head> em todas as páginas (inclusive a de obrigado, se houver).",
      "Botões de compra: <a href=\"https://pay.cakto.com.br/...\" data-track=\"checkout\">Comprar</a>.",
      "Botões que abrem o checkout via JavaScript: use window.CentralTracker.checkoutUrl(url) antes de redirecionar.",
    ],
  },
  {
    key: "builders",
    label: "GreatPages / Webflow",
    steps: [
      "GreatPages: Configurações da página → Scripts → “Head”. Webflow: Project Settings → Custom Code → Head Code.",
      "Cole o snippet, salve e publique.",
      "Se o construtor não deixa editar o link do botão, use o modo “clicar para marcar” e cole o seletor gerado.",
    ],
  },
];

export function PlatformTabs() {
  const [tab, setTab] = useState(PLATFORMS[0].key);
  const p = PLATFORMS.find((x) => x.key === tab)!;
  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {PLATFORMS.map((x) => (
          <button
            key={x.key}
            type="button"
            onClick={() => setTab(x.key)}
            className={cn("rounded-md px-2.5 py-1 text-xs", tab === x.key ? "bg-primary text-white" : "bg-panel-2 text-muted hover:text-text")}
          >
            {x.label}
          </button>
        ))}
      </div>
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted">
        {p.steps.map((s, i) => (
          <li key={i}>{s}</li>
        ))}
      </ol>
    </div>
  );
}
