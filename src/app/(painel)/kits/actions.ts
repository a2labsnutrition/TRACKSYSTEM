"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AiError } from "@/lib/ai/structured";
import { getDiscoverStore } from "@/lib/discover";
import { generateKitSection } from "@/lib/discover/kit-service";
import { SECTION_ORDER, type KitSectionKind } from "@/lib/discover/types";
import { createSupabaseServer } from "@/lib/supabase/server";
import type { ActionState } from "../conexoes/actions";

const fail = (e: unknown): ActionState => ({ ok: false, message: e instanceof AiError || e instanceof Error ? e.message : "Erro inesperado." });

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  if (!v) return null;
  const n = Number(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
const httpUrl = (v: string | null) => {
  if (!v) return null;
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
};

async function loadKit(kitId: string) {
  const d = await getDiscoverStore();
  const k = await d.store.getKit(kitId);
  if (!k) throw new Error("Kit não encontrado.");
  return { ...d, ...k };
}

/** Gera uma seção (uma chamada = uma função na Vercel, até 300 s). */
export async function generateSectionAction(kitId: string, kind: KitSectionKind): Promise<ActionState> {
  try {
    if (!SECTION_ORDER.includes(kind)) return { ok: false, message: "Seção desconhecida." };
    const { store, kit, sections, workspace } = await loadKit(kitId);
    const r = await generateKitSection(store, kit, sections, kind, workspace);
    revalidatePath(`/kits/${kitId}`);
    return { ok: true, message: r.message };
  } catch (e) {
    return fail(e);
  }
}

/** Salva a edição manual de uma seção como nova versão (markdown). */
export async function saveSectionMarkdownAction(kitId: string, kind: KitSectionKind, markdown: string): Promise<ActionState> {
  try {
    if (!SECTION_ORDER.includes(kind)) return { ok: false, message: "Seção desconhecida." };
    const md = markdown.trim();
    if (!md) return { ok: false, message: "O texto está vazio." };
    if (md.length > 200_000) return { ok: false, message: "Texto grande demais." };
    const { store } = await loadKit(kitId);
    const v = await store.saveSection(kitId, kind, "markdown", md, "Editado por você");
    revalidatePath(`/kits/${kitId}`);
    return { ok: true, message: `Versão ${v} salva.` };
  } catch (e) {
    return fail(e);
  }
}

export async function updateKitInputsAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const kitId = str(form, "kitId");
    if (!kitId) return { ok: false, message: "Kit inválido." };
    const { store, kit } = await loadKit(kitId);
    const rawCheckout = str(form, "checkoutUrl");
    const checkoutUrl = httpUrl(rawCheckout);
    if (rawCheckout && !checkoutUrl) return { ok: false, message: "Link do checkout inválido (use https://...)." };
    await store.updateKit(kitId, {
      title: str(form, "title") ?? kit.title,
      inputs: {
        productName: str(form, "productName"),
        productType: str(form, "productType"),
        price: num(form, "price"),
        checkoutUrl,
        audienceNotes: str(form, "audienceNotes"),
        dailyBudget: num(form, "dailyBudget"),
        maxCpa: num(form, "maxCpa"),
      },
    });
    revalidatePath(`/kits/${kitId}`);
    revalidatePath("/kits");
    return { ok: true, message: "Dados do produto salvos. Recalcule a estrutura da campanha para usar os novos valores." };
  } catch (e) {
    return fail(e);
  }
}

/**
 * "Lançar no Tracking": cria (ou atualiza) o produto com preço e CPA máximo no
 * Tracking. NÃO cria campanha no Meta — o sistema é consultivo; a campanha é
 * montada no Gerenciador de Anúncios seguindo o passo a passo do kit.
 */
export async function launchToTrackingAction(kitId: string): Promise<ActionState> {
  try {
    const { kit, mode, workspaceId, store } = await loadKit(kitId);
    const name = kit.inputs.productName?.trim() || kit.title;
    const price = kit.inputs.price;
    if (!price) return { ok: false, message: "Informe o preço do produto (em Dados do produto) antes de lançar." };
    if (mode === "demo") return { ok: false, message: "Modo demo: nada é salvo. Conecte o Supabase para criar o produto no Tracking." };
    const supabase = await createSupabaseServer();
    const row = { workspace_id: workspaceId, name, price, max_cpa: kit.inputs.maxCpa ?? null, kind: "principal" };
    const res = kit.productId
      ? await supabase.from("products").update(row).eq("id", kit.productId).eq("workspace_id", workspaceId).select("id").maybeSingle()
      : await supabase.from("products").insert({ ...row, cost_per_sale: 0, cost_pct: 0, cakto_product_ids: [] }).select("id").single();
    if (res.error) return { ok: false, message: res.error.message };
    const productId = (res.data?.id as string | undefined) ?? null;
    if (!productId) return { ok: false, message: "O produto vinculado não existe mais. Desvincule e tente de novo." };
    if (productId !== kit.productId) await store.updateKit(kitId, { productId });
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: kit.productId
        ? "Produto atualizado no Tracking."
        : "Produto criado no Tracking. Falta: o ID do produto da Cakto e os custos em Configurações, e vincular a campanha depois da 1ª sincronização.",
    };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteKitAction(kitId: string): Promise<ActionState> {
  try {
    const { store } = await loadKit(kitId);
    await store.deleteKit(kitId);
    revalidatePath("/kits");
  } catch (e) {
    return fail(e);
  }
  redirect("/kits");
}
