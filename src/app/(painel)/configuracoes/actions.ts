"use server";

import { revalidatePath } from "next/cache";
import { requireLiveWorkspace } from "@/lib/data";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { ActionState } from "../conexoes/actions";

const num = (v: FormDataEntryValue | null): number | null => {
  const raw = String(v ?? "").trim();
  // "1.234,56" (pt-BR) ou "97.5"
  const s = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const pct = (v: FormDataEntryValue | null): number | null => {
  const n = num(v);
  return n == null ? null : n / 100;
};

export async function saveWorkspace(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const tz = String(form.get("timezone") ?? "").trim();
    try {
      new Intl.DateTimeFormat("pt-BR", { timeZone: tz });
    } catch {
      return { ok: false, message: `Fuso inválido: ${tz}` };
    }
    const supabase = await createSupabaseServer();
    const { error } = await supabase
      .from("workspaces")
      .update({
        name: String(form.get("name") ?? ctx.workspace.name).trim() || ctx.workspace.name,
        timezone: tz,
        tax_rate: pct(form.get("taxRate")) ?? 0,
        default_fee_rate: pct(form.get("feeRate")) ?? 0.0699,
      })
      .eq("id", ctx.workspace.id);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/", "layout");
    return { ok: true, message: "Configurações salvas." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function saveProduct(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const id = String(form.get("id") ?? "");
    const name = String(form.get("name") ?? "").trim();
    const price = num(form.get("price"));
    if (!name || price == null) return { ok: false, message: "Informe nome e preço." };
    const row = {
      workspace_id: ctx.workspace.id,
      name,
      price,
      net_per_sale: num(form.get("netPerSale")),
      target_cpa: num(form.get("targetCpa")),
      max_cpa: num(form.get("maxCpa")),
      min_roas: num(form.get("minRoas")),
      cakto_product_ids: String(form.get("caktoIds") ?? "")
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    };
    const supabase = await createSupabaseServer();
    const { error } = id ? await supabase.from("products").update(row).eq("id", id) : await supabase.from("products").insert(row);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/", "layout");
    return { ok: true, message: id ? "Produto atualizado." : "Produto criado." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}

export async function linkCampaigns(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const supabase = await createSupabaseServer();
    let n = 0;
    for (const [k, v] of form.entries()) {
      if (!k.startsWith("c_")) continue;
      const { error } = await supabase
        .from("campaigns")
        .update({ product_id: String(v) || null })
        .eq("workspace_id", ctx.workspace.id)
        .eq("id", k.slice(2));
      if (error) return { ok: false, message: error.message };
      n++;
    }
    revalidatePath("/", "layout");
    return { ok: true, message: `${n} campanha(s) atualizada(s).` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
