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
      kind: ["principal", "order_bump", "upsell"].includes(String(form.get("kind"))) ? String(form.get("kind")) : "principal",
      cost_per_sale: Math.max(0, num(form.get("costPerSale")) ?? 0),
      cost_pct: Math.min(1, Math.max(0, pct(form.get("costPct")) ?? 0)),
      cakto_product_ids: String(form.get("caktoIds") ?? "")
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean),
    };
    const supabase = await createSupabaseServer();
    const res = id
      ? await supabase.from("products").update(row).eq("id", id).select("id").single()
      : await supabase.from("products").insert(row).select("id").single();
    if (res.error) return { ok: false, message: res.error.message };
    const productId = res.data.id as string;

    // Ajustes das regras de decisão (vazio = padrão do sistema)
    const rules: Record<string, number> = {};
    const setNum = (key: string, v: number | null) => {
      if (v != null && v >= 0) rules[key] = v;
    };
    setNum("killSpendMultiple", num(form.get("killSpendMultiple")));
    setNum("frequencyMax", num(form.get("frequencyMax")));
    setNum("minPurchasesToScale", num(form.get("minPurchasesToScale")));
    setNum("minLinkClicks", num(form.get("minLinkClicks")));
    setNum("connectRateMin", pct(form.get("connectRateMin")));
    setNum("minTestBudget", num(form.get("minTestBudget")));
    const { error: rErr } = await supabase
      .from("decision_rules")
      .upsert({ workspace_id: ctx.workspace.id, product_id: productId, config: rules }, { onConflict: "workspace_id,product_id" });
    if (rErr) return { ok: false, message: `Produto salvo, mas as regras falharam: ${rErr.message}` };
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

/** Câmbio da conta de anúncios (gasto em moeda estrangeira → R$). */
export async function saveAdAccountFx(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const id = String(form.get("id") ?? "");
    if (!ctx.adAccounts.some((a) => a.id === id)) return { ok: false, message: "Conta não encontrada neste workspace." };
    const mode = form.get("fxMode") === "manual" ? "manual" : "auto";
    const manual = num(form.get("fxManualRate"));
    const spread = pct(form.get("fxSpreadPct"));
    if (mode === "manual" && !(manual && manual > 0)) return { ok: false, message: "Informe a cotação manual (R$ por unidade da moeda da conta)." };
    if (spread != null && (spread < 0 || spread > 0.2)) return { ok: false, message: "IOF + spread deve ficar entre 0% e 20%." };
    const supabase = await createSupabaseServer();
    const { error } = await supabase
      .from("ad_accounts")
      .update({ fx_mode: mode, fx_manual_rate: manual, fx_spread_pct: spread ?? 0.035 })
      .eq("workspace_id", ctx.workspace.id)
      .eq("id", id);
    if (error) return { ok: false, message: error.message };
    revalidatePath("/", "layout");
    return { ok: true, message: "Câmbio salvo." };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
