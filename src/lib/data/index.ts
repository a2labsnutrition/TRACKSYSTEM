import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { isSupabaseConfigured } from "@/lib/env";
import { createSupabaseServer } from "@/lib/supabase/server";
import { DemoRepository } from "./demo/repo";
import type { Repository } from "./repository";
import { SupabaseRepository } from "./supabase/repo";
import { DEFAULT_NOTIFY, type WorkspaceContext } from "./types";

export const DEMO_COOKIE = "cc_demo";
export const WS_COOKIE = "cc_ws";

/**
 * Resolve o repositório da requisição:
 *  - Supabase não configurado  -> modo demo (sem login)
 *  - usuário com cookie cc_demo -> modo demo
 *  - senão -> dados reais do workspace ativo (RLS do usuário)
 */
export const getRepository = cache(async (): Promise<Repository> => {
  const jar = await cookies();
  if (!isSupabaseConfigured()) return new DemoRepository(null);

  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (jar.get(DEMO_COOKIE)?.value === "1") return new DemoRepository(user.email ?? null);

  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces(id, name, timezone, currency, tax_rate, default_fee_rate, notify)")
    .eq("user_id", user.id);
  if (!memberships?.length) redirect("/onboarding");

  const wanted = jar.get(WS_COOKIE)?.value;
  const m = memberships.find((x) => x.workspace_id === wanted) ?? memberships[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const w = (Array.isArray(m.workspaces) ? m.workspaces[0] : m.workspaces) as any;

  const { data: accounts } = await supabase
    .from("ad_accounts")
    .select("id, meta_account_id, name, currency, timezone, account_status, last_synced_at")
    .eq("workspace_id", w.id)
    .eq("is_active", true);

  const ctx: WorkspaceContext = {
    mode: "live",
    userEmail: user.email ?? null,
    workspace: {
      id: w.id,
      name: w.name,
      timezone: w.timezone,
      currency: w.currency,
      taxRate: Number(w.tax_rate ?? 0),
      defaultFeeRate: Number(w.default_fee_rate ?? 0.0699),
      notify: { ...DEFAULT_NOTIFY, ...(w.notify ?? {}) },
    },
    adAccounts: (accounts ?? []).map((a) => ({
      id: a.id,
      metaAccountId: a.meta_account_id,
      name: a.name,
      currency: a.currency,
      timezone: a.timezone,
      status: a.account_status ?? "",
      lastSyncedAt: a.last_synced_at,
    })),
  };
  return new SupabaseRepository(supabase, ctx);
});

/** Para rotas que exigem modo real (ex.: salvar credenciais). */
export async function requireLiveWorkspace(): Promise<{ ctx: WorkspaceContext; userId: string }> {
  if (!isSupabaseConfigured()) throw new Error("Configure o Supabase para conectar contas reais (veja .env.example).");
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Faça login.");
  const repo = await getRepository();
  const ctx = await repo.context();
  if (ctx.mode !== "live") throw new Error("Desative o modo demo para conectar contas reais.");
  return { ctx, userId: user.id };
}
