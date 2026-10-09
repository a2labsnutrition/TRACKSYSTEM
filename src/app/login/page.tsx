import { BarChart3 } from "lucide-react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { isSupabaseConfigured } from "@/lib/env";
import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar" };

export default async function Login({ searchParams }: { searchParams: Promise<{ erro?: string }> }) {
  await connection(); // sempre dinâmica: depende das variáveis de ambiente em tempo de execução
  if (!isSupabaseConfigured()) redirect("/");
  const { erro } = await searchParams;
  return (
    <div className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-panel p-6">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/20 text-primary">
            <BarChart3 className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold">Central de Comando</p>
            <p className="text-xs text-faint">Meta Ads · tracking e decisões</p>
          </div>
        </div>
        {erro ? <p className="mb-3 text-xs text-bad">{erro}</p> : null}
        <LoginForm />
      </div>
    </div>
  );
}
