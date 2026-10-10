/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Lê o criativo do Meta em todos os formatos comuns (parser tolerante):
 *  - campos diretos (title, body, video_id, image_url…);
 *  - object_story_spec.link_data / video_data (anúncio criado no Gerenciador);
 *  - asset_feed_spec (criativo dinâmico / Advantage+: várias variações de
 *    texto, título, vídeo e link);
 *  - publicação existente (effective_object_story_id): o texto fica na
 *    publicação e é buscado à parte quando a permissão permitir.
 */

export interface ParsedCreative {
  title: string | null;
  body: string | null;
  callToAction: string | null;
  imageUrl: string | null;
  videoId: string | null;
  linkUrl: string | null;
  format: "video" | "image" | "carousel" | "unknown";
  /** Todas as variações de texto principal (criativo dinâmico). */
  bodies: string[];
  /** Todas as variações de título. */
  titles: string[];
  videoIds: string[];
  storyId: string | null;
}

const txt = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
const uniq = (xs: Array<string | null | undefined>) => [...new Set(xs.map((x) => txt(x)).filter((x): x is string => Boolean(x)))];

export function parseCreative(c: any): ParsedCreative {
  if (!c || typeof c !== "object") {
    return { title: null, body: null, callToAction: null, imageUrl: null, videoId: null, linkUrl: null, format: "unknown", bodies: [], titles: [], videoIds: [], storyId: null };
  }
  const oss = c.object_story_spec ?? {};
  const ld = oss.link_data ?? {};
  const vd = oss.video_data ?? {};
  const afs = c.asset_feed_spec ?? {};

  const bodies = uniq([c.body, ld.message, vd.message, ...(afs.bodies ?? []).map((b: any) => b?.text)]);
  const titles = uniq([c.title, ld.name, vd.title, ...(afs.titles ?? []).map((t: any) => t?.text)]);
  const videoIds = uniq([c.video_id, vd.video_id, ...(afs.videos ?? []).map((v: any) => v?.video_id)]);
  const links = uniq([
    c.link_url,
    ld.link,
    ld.call_to_action?.value?.link,
    vd.call_to_action?.value?.link,
    ...(afs.link_urls ?? []).map((l: any) => l?.website_url),
  ]);
  const cta = txt(c.call_to_action_type) ?? txt(ld.call_to_action?.type) ?? txt(vd.call_to_action?.type) ?? txt(afs.call_to_action_types?.[0]);
  const image = txt(c.image_url) ?? txt(ld.picture) ?? txt(vd.image_url) ?? null;

  let format: ParsedCreative["format"] = "unknown";
  if (videoIds.length) format = "video";
  else if (ld.child_attachments?.length || afs.ad_formats?.includes?.("CAROUSEL")) format = "carousel";
  else if (image || ld.image_hash || c.thumbnail_url || afs.images?.length) format = "image";

  return {
    title: titles[0] ?? null,
    body: bodies[0] ?? null,
    callToAction: cta,
    imageUrl: image,
    videoId: videoIds[0] ?? null,
    linkUrl: links[0] ?? null,
    format,
    bodies,
    titles,
    videoIds,
    storyId: txt(c.effective_object_story_id) ?? txt(c.object_story_id),
  };
}
