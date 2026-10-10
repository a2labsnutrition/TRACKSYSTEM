import "server-only";
import { hasAi } from "@/lib/ai/structured";
import type { Workspace } from "@/lib/data/types";
import { todayIn } from "@/lib/tz";
import { generateComplianceRewrites, generateLanding, generateOffer, generatePlan, generateScripts, generateVsl, type KitContext } from "./ai";
import { scanValue, type ComplianceFlag } from "./compliance";
import type { ComplianceData } from "./markdown";
import type { PlanContent } from "./schemas";
import { latestSections, type DiscoverStore } from "./store";
import { buildCampaignStructure } from "./structure";
import { SECTION_LABEL, type KitRoot, type KitSection, type KitSectionKind } from "./types";

/** Ângulos do plano (estruturado ou markdown editado: "### 1. Nome" dentro de "## Ângulos"). */
export function planAngles(plan: KitSection | undefined): string[] {
  if (!plan) return [];
  if (plan.format === "structured") return ((plan.data as PlanContent).angulos ?? []).map((a) => a.nome).filter(Boolean);
  const md = typeof plan.data === "string" ? plan.data : "";
  const block = /##\s+Ângulos([\s\S]*?)(\n##\s|$)/i.exec(md)?.[1] ?? md;
  return [...block.matchAll(/^###\s+(?:\d+[.)]\s*)?(.+)$/gm)].map((m) => m[1].trim()).filter(Boolean);
}

function dataOf<T>(s: KitSection | undefined): T | string | null {
  return s ? (s.data as T | string) : null;
}

/** Contexto da IA (nicho, produto, referências, plano e oferta mais recentes). */
export async function buildKitContext(store: DiscoverStore, kit: KitRoot, sections: KitSection[]): Promise<KitContext> {
  const latest = latestSections(sections);
  const allRefs = await store.listReferences();
  return {
    nicheSlug: kit.nicheSlug,
    subnicheSlug: kit.subnicheSlug,
    inputs: kit.inputs,
    refs: allRefs.filter((r) => kit.referenceIds.includes(r.id)),
    plan: dataOf<PlanContent>(latest.get("plan")) as KitContext["plan"],
    offer: dataOf(latest.get("offer")) as KitContext["offer"],
  };
}

/**
 * Gera (ou recalcula) uma seção do kit e salva como nova versão.
 * Dependências: oferta, página, VSL e roteiros usam o plano; roteiros usam os ângulos dele.
 */
export async function generateKitSection(
  store: DiscoverStore,
  kit: KitRoot,
  sections: KitSection[],
  kind: KitSectionKind,
  ws: Pick<Workspace, "timezone" | "taxRate" | "defaultFeeRate">,
): Promise<{ version: number; message: string }> {
  const latest = latestSections(sections);
  const ctx = await buildKitContext(store, kit, sections);
  const needPlan = () => {
    if (!latest.get("plan")) throw new Error("Gere o plano de ataque primeiro.");
  };
  const save = async (data: unknown, note: string | null) => {
    const version = await store.saveSection(kit.id, kind, "structured", data, note);
    return { version, message: `${SECTION_LABEL[kind]}: versão ${version} salva.` };
  };

  switch (kind) {
    case "plan": {
      const r = await generatePlan(ctx);
      return save(r.data, `IA (${r.model})`);
    }
    case "offer": {
      needPlan();
      const r = await generateOffer(ctx);
      return save(r.data, `IA (${r.model})`);
    }
    case "landing": {
      needPlan();
      const r = await generateLanding(ctx);
      return save(r.data, `IA (${r.model})`);
    }
    case "vsl": {
      needPlan();
      const r = await generateVsl(ctx);
      return save(r.data, `IA (${r.model})`);
    }
    case "scripts": {
      needPlan();
      const angles = planAngles(latest.get("plan"));
      const r = await generateScripts(ctx, angles);
      return save(r.data, `IA (${r.model}) · ${r.data.angulos.length} ângulo(s)`);
    }
    case "structure": {
      const s = buildCampaignStructure({
        productName: kit.inputs.productName || kit.title,
        price: kit.inputs.price ?? null,
        maxCpa: kit.inputs.maxCpa ?? null,
        feeRate: ws.defaultFeeRate,
        taxRate: ws.taxRate,
        dailyBudget: kit.inputs.dailyBudget ?? null,
        angles: planAngles(latest.get("plan")),
        date: todayIn(ws.timezone),
      });
      return save(s, "Calculada pelo sistema (mesmas regras do motor de decisão)");
    }
    case "compliance": {
      const scanned: string[] = [];
      const flags: ComplianceFlag[] = [];
      for (const k of ["offer", "landing", "vsl", "scripts"] as const) {
        const sec = latest.get(k);
        if (!sec) continue;
        scanned.push(SECTION_LABEL[k]);
        flags.push(...scanValue(sec.data, SECTION_LABEL[k]));
      }
      if (!scanned.length) throw new Error("Gere a oferta, a página, a VSL ou os roteiros antes de verificar.");
      let rewrites: ComplianceData["rewrites"] = null;
      let note = "Verificador automático";
      if (flags.length && hasAi()) {
        const r = await generateComplianceRewrites(
          flags.map((f) => ({ trecho: f.excerpt, regra: f.label, secao: f.section })),
          ctx,
        );
        rewrites = r.data;
        note += ` + reescritas da IA (${r.model})`;
      }
      const data: ComplianceData = { flags, rewrites, scanned, scannedAt: new Date().toISOString() };
      const out = await save(data, note);
      return { ...out, message: `${flags.length} trecho(s) sinalizado(s). ${out.message}` };
    }
  }
}
