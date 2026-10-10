"use server";

import { revalidatePath } from "next/cache";
import { notifyAlerts } from "@/lib/alerts/notify";
import { runAlertsForWorkspace } from "@/lib/alerts/run";
import { requireLiveWorkspace } from "@/lib/data";
import { env, isServiceRoleConfigured } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { ActionState } from "../conexoes/actions";

export async function resolveAlert(id: string): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const supabase = await createSupabaseServer();
    const { error } = await supabase
      .from("alerts")
      .update({ status: "resolved", resolved_at: new Date().toISOString() })
      .eq("id", id)
      .eq("workspace_id", ctx.workspace.id);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/alertas");
    return { ok: true, message: "Alerta marcado como resolvido." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function saveNotify(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const emails = String(form.get("emails") ?? "")
      .split(/[\s,;]+/)
      .map((e) => e.trim().toLowerCase())
      .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))
      .slice(0, 10);
    const telegramChatId = String(form.get("telegramChatId") ?? "").trim() || null;
    const minSeverity = form.get("minSeverity") === "critico" ? "critico" : "atencao";
    const supabase = await createSupabaseServer();
    const { error } = await supabase.from("workspaces").update({ notify: { emails, telegramChatId, minSeverity } }).eq("id", ctx.workspace.id);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/alertas");
    return { ok: true, message: "Notificações salvas." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function testNotify(): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const n = ctx.workspace.notify;
    if (!n.emails.length && !n.telegramChatId) return { ok: false, message: "Cadastre um e-mail ou um chat do Telegram e salve primeiro." };
    const results = await notifyAlerts(
      n,
      [{ type: "teste", severity: "atencao", entityLevel: "workspace", entityId: null, title: "Teste de notificação", message: "Se você recebeu isto, os alertas vão chegar aqui.", href: "/alertas", dedupeKey: "teste" }],
      env.appUrl,
      ctx.workspace.name,
    );
    const ok = results.every((r) => r.ok);
    return { ok, message: results.map((r) => `${r.channel === "email" ? "E-mail" : "Telegram"}: ${r.detail}`).join(" · ") };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function checkAlertsNow(): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    if (!isServiceRoleConfigured()) return { ok: false, message: "Falta SUPABASE_SERVICE_ROLE_KEY." };
    const r = await runAlertsForWorkspace(supabaseAdmin(), ctx.workspace.id);
    revalidatePath("/alertas");
    return { ok: true, message: `${r.opened.length} novo(s), ${r.resolved} resolvido(s), ${r.notified} notificado(s).` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
