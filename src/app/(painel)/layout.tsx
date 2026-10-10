import { AlertTriangle, FlaskConical } from "lucide-react";
import { after } from "next/server";
import { getRepository } from "@/lib/data";
import { isSupabaseConfigured } from "@/lib/env";
import { sameOffset } from "@/lib/tz";
import { autoSyncWorkspace, needsAutoSync } from "@/lib/integrations/meta/auto-sync";
import { MobileNav, Sidebar } from "@/components/layout/nav";

export default async function PainelLayout({ children }: { children: React.ReactNode }) {
  const repo = await getRepository();
  const ctx = await repo.context();
  const tzMismatch = ctx.adAccounts.filter((a) => !sameOffset(a.timezone, ctx.workspace.timezone));
  // Dados com mais de 1 h: sincroniza em segundo plano depois de responder
  if (ctx.mode === "live" && needsAutoSync(ctx.adAccounts)) {
    const ws = ctx.workspace.id;
    after(() => autoSyncWorkspace(ws));
  }

  return (
    <div className="flex min-h-dvh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-border bg-bg/85 px-4 py-2.5 backdrop-blur lg:px-6">
          <MobileNav />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{ctx.workspace.name}</p>
            <p className="truncate text-[11px] text-faint">
              Fuso {ctx.workspace.timezone} · {ctx.adAccounts.length} conta(s) de anúncio
              {ctx.userEmail ? ` · ${ctx.userEmail}` : ""}
            </p>
          </div>
          {ctx.mode === "demo" ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/40 bg-warn/10 px-2.5 py-1 text-[11px] font-semibold text-warn">
              <FlaskConical className="h-3.5 w-3.5" />
              DADOS FICTÍCIOS
            </span>
          ) : null}
          {isSupabaseConfigured() ? (
            <form action="/api/demo" method="post">
              <input type="hidden" name="on" value={ctx.mode === "demo" ? "0" : "1"} />
              <button className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted hover:bg-panel-2 hover:text-text">
                {ctx.mode === "demo" ? "Sair do demo" : "Ver demo"}
              </button>
            </form>
          ) : null}
        </header>

        {ctx.mode === "demo" ? (
          <div className="border-b border-warn/20 bg-warn/5 px-4 py-2 text-xs text-warn lg:px-6">
            <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
              <span className="min-w-0 sm:flex-1">
                Modo demonstração: todos os números abaixo são fictícios, só para você ver o sistema funcionando.
                {isSupabaseConfigured() ? " Use “Sair do demo” para ver seus dados reais." : " Configure o Supabase (.env) para conectar suas contas reais."}
              </span>
              <form action="/api/demo" method="post" className="flex flex-wrap items-center gap-1.5">
                <span className="text-faint">Cenário:</span>
                <button
                  name="cenario"
                  value="completo"
                  className={ctx.workspace.id === "caso-real" ? "rounded border border-warn/30 px-2 py-0.5 hover:bg-warn/10" : "rounded bg-warn/20 px-2 py-0.5 font-semibold"}
                >
                  Demo completo
                </button>
                <button
                  name="cenario"
                  value="caso-real"
                  className={ctx.workspace.id === "caso-real" ? "rounded bg-warn/20 px-2 py-0.5 font-semibold" : "rounded border border-warn/30 px-2 py-0.5 hover:bg-warn/10"}
                >
                  Caso real (dia 1, US$)
                </button>
              </form>
            </div>
          </div>
        ) : null}
        {tzMismatch.length ? (
          <div className="flex items-center gap-2 border-b border-warn/20 bg-warn/5 px-4 py-2 text-xs text-warn lg:px-6">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Fuso da conta de anúncios ({tzMismatch.map((a) => a.timezone).join(", ")}) diferente do fuso do painel ({ctx.workspace.timezone}). Gasto diário segue o fuso da conta; vendas seguem o fuso do painel.
          </div>
        ) : null}

        <main className="mx-auto w-full max-w-[1500px] flex-1 px-4 py-5 lg:px-6">{children}</main>
      </div>
    </div>
  );
}
