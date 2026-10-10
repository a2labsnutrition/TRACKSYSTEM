import "server-only";
import { getRepository } from "@/lib/data";
import { appOrigin } from "@/lib/origin";
import { getDiscoverStore } from ".";
import { buildLovablePrompt } from "./lovable";
import type { LandingContent, OfferContent } from "./schemas";
import { latestSections } from "./store";
import type { KitSection, KitSectionKind } from "./types";

/** Seção escolhida: a versão pedida ou a mais recente. */
export function pickSection(sections: KitSection[], kind: KitSectionKind, version?: number | null): KitSection | undefined {
  if (version) {
    const s = sections.find((x) => x.kind === kind && x.version === version);
    if (s) return s;
  }
  return latestSections(sections).get(kind);
}

/** Tudo que a página do kit e a exportação HTML precisam. */
export async function loadKitView(id: string, versions: Partial<Record<KitSectionKind, number>> = {}) {
  const d = await getDiscoverStore();
  const k = await d.store.getKit(id);
  if (!k) return null;
  const repo = await getRepository();
  const sites = await repo.sites();
  const site = sites[0] ?? null;
  const origin = await appOrigin();
  const trackingSnippet = site ? `<script src="${origin}/t.js" data-site="${site.publicKey}" async></script>` : null;

  const landing = pickSection(k.sections, "landing", versions.landing);
  const offer = pickSection(k.sections, "offer", versions.offer);
  const landingData = landing ? (landing.format === "markdown" ? (landing.data as string) : (landing.data as LandingContent)) : null;
  const offerData = offer?.format === "structured" ? (offer.data as OfferContent) : null;
  const productName = k.kit.inputs.productName?.trim() || k.kit.title;
  const lovablePrompt = landingData
    ? buildLovablePrompt({ landing: landingData, offer: offerData, productName, checkoutUrl: k.kit.inputs.checkoutUrl ?? null, trackingSnippet })
    : null;

  return { ...d, ...k, site, trackingSnippet, landing, landingData, offerData, productName, lovablePrompt };
}
