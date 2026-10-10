"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AiError } from "@/lib/ai/structured";
import { analyzeReference, generateNicheSeed } from "@/lib/discover/ai";
import { getDiscoverStore } from "@/lib/discover";
import { findNiche, findSubniche } from "@/lib/discover/niches";
import type { RefFormat } from "@/lib/discover/types";
import { parseAdLibraryUrl } from "@/lib/integrations/adlibrary";
import type { ActionState } from "../conexoes/actions";

const str = (f: FormData, k: string) => {
  const v = f.get(k);
  return typeof v === "string" && v.trim() ? v.trim() : null;
};
const num = (f: FormData, k: string) => {
  const v = str(f, k);
  if (!v) return null;
  const n = Number(v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v);
  return Number.isFinite(n) ? n : null;
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
const fail = (e: unknown): ActionState => ({ ok: false, message: e instanceof AiError || e instanceof Error ? e.message : "Erro inesperado." });

function revalidateDiscover(slug?: string | null) {
  revalidatePath("/descobrir");
  revalidatePath("/descobrir/referencias");
  if (slug) revalidatePath(`/descobrir/${slug}`);
}

export async function addReferenceAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { store } = await getDiscoverStore();
    const rawUrl = str(form, "sourceUrl");
    const parsed = parseAdLibraryUrl(rawUrl);
    if (rawUrl && !parsed) return { ok: false, message: "Link inválido. Cole o endereço completo (https://...)." };
    const nicheSlug = str(form, "nicheSlug");
    const niche = nicheSlug ? findNiche(nicheSlug) : undefined;
    if (nicheSlug && !niche) return { ok: false, message: "Nicho desconhecido." };
    const subnicheSlug = niche ? (findSubniche(niche, str(form, "subnicheSlug"))?.slug ?? null) : null;
    const copy = str(form, "copy");
    if (!parsed && !copy && !str(form, "hook")) return { ok: false, message: "Informe pelo menos o link, o texto ou o gancho do anúncio." };
    const fmt = str(form, "format");
    const ref = await store.addReference({
      source: "manual",
      sourceUrl: parsed?.url ?? null,
      libraryId: parsed?.libraryId ?? null,
      nicheSlug,
      subnicheSlug,
      advertiser: str(form, "advertiser"),
      format: (["video", "image", "carousel"].includes(fmt ?? "") ? fmt : "unknown") as RefFormat,
      firstSeen: str(form, "firstSeen"),
      variations: num(form, "variations"),
      country: str(form, "country") ?? "BR",
      price: num(form, "price"),
      copy,
      hook: str(form, "hook"),
      angle: str(form, "angle"),
      cta: str(form, "cta"),
      landingType: str(form, "landingType"),
      landingUrl: str(form, "landingUrl"),
      notes: str(form, "notes"),
      tags: (str(form, "tags") ?? "").split(",").map((t) => t.trim()).filter(Boolean),
    });
    let msg = "Referência salva.";
    if (form.get("analyze") === "1") {
      try {
        await store.setReferenceAnalysis(ref.id, await analyzeReference(ref));
        msg = "Referência salva e analisada pela IA.";
      } catch (e) {
        msg = `Referência salva. Análise da IA falhou: ${(e as Error).message}`;
      }
    }
    revalidateDiscover(nicheSlug);
    return { ok: true, message: msg };
  } catch (e) {
    return fail(e);
  }
}

export async function analyzeReferenceAction(id: string): Promise<ActionState> {
  try {
    const { store } = await getDiscoverStore();
    const ref = await store.getReference(id);
    if (!ref) return { ok: false, message: "Referência não encontrada." };
    await store.setReferenceAnalysis(id, await analyzeReference(ref));
    revalidateDiscover(ref.nicheSlug);
    return { ok: true, message: "Análise pronta." };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteReferenceAction(id: string): Promise<ActionState> {
  try {
    const { store } = await getDiscoverStore();
    const ref = await store.getReference(id);
    await store.deleteReference(id);
    revalidateDiscover(ref?.nicheSlug);
    return { ok: true, message: "Referência removida." };
  } catch (e) {
    return fail(e);
  }
}

export async function estimateNicheAction(slug: string): Promise<ActionState> {
  try {
    const niche = findNiche(slug);
    if (!niche) return { ok: false, message: "Nicho desconhecido." };
    const { store } = await getDiscoverStore();
    const seed = await generateNicheSeed(niche);
    await store.saveNicheSeed(slug, niche.name, niche.policy.level === "alto", seed);
    revalidateDiscover(slug);
    return { ok: true, message: "Estimativa da IA salva (marcada como estimativa)." };
  } catch (e) {
    return fail(e);
  }
}

export async function createCollectionAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const name = str(form, "name");
    if (!name) return { ok: false, message: "Dê um nome à coleção." };
    const { store } = await getDiscoverStore();
    await store.createCollection(name.slice(0, 80));
    revalidateDiscover();
    return { ok: true, message: "Coleção criada." };
  } catch (e) {
    return fail(e);
  }
}

export async function addToCollectionAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const collectionId = str(form, "collectionId");
    const refId = str(form, "refId");
    if (!collectionId || !refId) return { ok: false, message: "Escolha a coleção." };
    const { store } = await getDiscoverStore();
    await store.addToCollection(collectionId, refId, str(form, "note"));
    revalidateDiscover();
    return { ok: true, message: "Adicionada à coleção." };
  } catch (e) {
    return fail(e);
  }
}

export async function removeFromCollectionAction(collectionId: string, refId: string): Promise<ActionState> {
  try {
    const { store } = await getDiscoverStore();
    await store.removeFromCollection(collectionId, refId);
    revalidateDiscover();
    return { ok: true, message: "Removida da coleção." };
  } catch (e) {
    return fail(e);
  }
}

/** Cria o kit (plano de ataque) e abre a página dele. */
export async function createKitAction(_: ActionState, form: FormData): Promise<ActionState> {
  let id: string;
  try {
    const nicheSlug = str(form, "nicheSlug");
    const niche = nicheSlug ? findNiche(nicheSlug) : undefined;
    if (!niche) return { ok: false, message: "Escolha o nicho." };
    const subnicheSlug = str(form, "subnicheSlug");
    const sub = niche.subniches.find((s) => s.slug === subnicheSlug);
    const { store } = await getDiscoverStore();
    const kit = await store.createKit({
      title: str(form, "title") ?? `${niche.name}${sub ? ` · ${sub.name}` : ""}`,
      nicheSlug: niche.slug,
      subnicheSlug: sub?.slug ?? null,
      referenceIds: form.getAll("refIds").map(String).filter(Boolean).slice(0, 30),
      inputs: {
        productName: str(form, "productName"),
        productType: str(form, "productType"),
        price: num(form, "price"),
        checkoutUrl: httpUrl(str(form, "checkoutUrl")),
        audienceNotes: str(form, "audienceNotes"),
        dailyBudget: num(form, "dailyBudget"),
        maxCpa: num(form, "maxCpa"),
      },
    });
    id = kit.id;
    revalidatePath("/kits");
  } catch (e) {
    return fail(e);
  }
  redirect(`/kits/${id}?criar=1`);
}
