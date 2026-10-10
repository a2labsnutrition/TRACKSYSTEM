import "server-only";
import { campaignDetail } from "@/lib/analytics";
import { getRepository } from "@/lib/data";
import type { Repository } from "@/lib/data/repository";
import type { Workspace } from "@/lib/data/types";
import { createSupabaseServer } from "@/lib/supabase/server";
import { resolvePeriod, todayIn } from "@/lib/tz";
import { sameAdName } from "./flow";
import type { LearnedCreative } from "./learning";
import { MemoryCreativeStore, type CreativeStore } from "./store";
import { SupabaseCreativeStore } from "./supabase-store";

const g = globalThis as unknown as { __ccCreativeDemo?: MemoryCreativeStore };

export async function getCreativeStore(): Promise<{ store: CreativeStore; repo: Repository; workspace: Workspace; mode: "demo" | "live" }> {
  const repo = await getRepository();
  const ctx = await repo.context();
  if (ctx.mode === "demo") {
    if (!g.__ccCreativeDemo) {
      const s = new MemoryCreativeStore();
      await seedDemo(s, repo, todayIn(ctx.workspace.timezone));
      g.__ccCreativeDemo = s;
    }
    return { store: g.__ccCreativeDemo, repo, workspace: ctx.workspace, mode: "demo" };
  }
  return { store: new SupabaseCreativeStore(await createSupabaseServer(), ctx.workspace.id), repo, workspace: ctx.workspace, mode: "live" };
}

/** Modo demo: alguns criativos "enviados" com o nome de anúncios fictícios, para o ciclo de aprendizado aparecer. */
async function seedDemo(s: MemoryCreativeStore, repo: Repository, today: string) {
  const ads = (await repo.ads()).slice(0, 8);
  for (const a of ads) {
    const angle = a.name.split("_")[1] ?? "geral";
    await s.addAsset({ kitId: null, storagePath: `demo/${a.id}.mp4`, adName: a.name, angle, hook: null, metaAdId: a.id });
  }
  await s.addQueueItems(
    [
      { title: "Gancho do espelho", angle: "dor-espelho", prompt: "Vertical video, woman in her 30s looks at herself in a bathroom mirror in soft morning light, sighs, then smiles with determination. Handheld, natural, UGC style.", ratio: "9:16", durationS: 8, variant: "A" as const, hook: null },
      { title: "Prova social em casa", angle: "prova-social", prompt: "Close-up of hands writing a weekly meal plan on a kitchen table, bright daylight, cozy home, authentic smartphone footage.", ratio: "9:16", durationS: 8, variant: "A" as const, hook: null },
    ].map((x, i) => ({ ...x, kitId: null, priority: 1000 - i, scheduledFor: today, status: "backlog" as const })),
  );
}

/**
 * Liga os criativos enviados aos anúncios do Meta pelo nome (padrão do tracking)
 * e lê o veredicto de cada um na inteligência de criativos (últimos 30 dias).
 */
export async function learnFromMeta(repo: Repository, store: CreativeStore, ws: Workspace): Promise<{ learned: LearnedCreative[]; unmatched: number }> {
  const assets = (await store.listAssets()).filter((a) => a.adName);
  if (!assets.length) return { learned: [], unmatched: 0 };
  const ads = await repo.ads();
  const match = new Map<string, (typeof ads)[number]>();
  for (const a of assets) {
    const ad = (a.metaAdId && ads.find((x) => x.id === a.metaAdId)) || ads.find((x) => sameAdName(x.name, a.adName));
    if (!ad) continue;
    match.set(a.id, ad);
    if (a.metaAdId !== ad.id) await store.updateAsset(a.id, { metaAdId: ad.id });
  }
  const campaignIds = [...new Set([...match.values()].map((a) => a.campaignId))].slice(0, 6);
  const period = resolvePeriod(ws.timezone, "30d");
  const details = await Promise.all(campaignIds.map((id) => campaignDetail(repo, id, period).catch(() => null)));
  const byAd = new Map<string, { verdict: LearnedCreative["verdict"]; reasons: string[]; spend: number; purchases: number; campaign: string }>();
  for (const d of details) {
    if (!d) continue;
    for (const c of d.creatives.ads) byAd.set(c.id, { verdict: c.verdict, reasons: c.reasons, spend: c.meta.spend, purchases: c.purchases, campaign: d.campaign.name });
  }
  const learned: LearnedCreative[] = [];
  for (const a of assets) {
    const ad = match.get(a.id);
    const r = ad ? byAd.get(ad.id) : undefined;
    if (!ad || !r) continue;
    learned.push({ assetId: a.id, adName: ad.name, angle: a.angle ?? "geral", hook: a.hook, campaignName: r.campaign, verdict: r.verdict, reasons: r.reasons, spend: r.spend, purchases: r.purchases });
  }
  return { learned, unmatched: assets.length - match.size };
}
