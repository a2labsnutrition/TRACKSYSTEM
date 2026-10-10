import { describe, expect, it } from "vitest";
import { parseCreative } from "@/lib/integrations/meta/creative-parse";

describe("leitura do criativo do Meta", () => {
  it("criativo dinâmico (asset_feed_spec): textos, títulos, vídeos e link", () => {
    const p = parseCreative({
      thumbnail_url: "https://t",
      asset_feed_spec: {
        bodies: [{ text: "Texto A" }, { text: "Texto B" }],
        titles: [{ text: "Título 1" }],
        videos: [{ video_id: "v1" }, { video_id: "v2" }],
        link_urls: [{ website_url: "https://minhapagina.com" }],
        call_to_action_types: ["LEARN_MORE"],
      },
    });
    expect(p).toMatchObject({ body: "Texto A", title: "Título 1", videoId: "v1", linkUrl: "https://minhapagina.com", callToAction: "LEARN_MORE", format: "video" });
    expect(p.bodies).toEqual(["Texto A", "Texto B"]);
    expect(p.videoIds).toEqual(["v1", "v2"]);
  });
  it("vídeo criado no Gerenciador (video_data)", () => {
    const p = parseCreative({ object_story_spec: { video_data: { message: "Fala do vídeo", title: "Título", video_id: "v9", image_url: "https://i", call_to_action: { type: "SHOP_NOW", value: { link: "https://pag.com" } } } } });
    expect(p).toMatchObject({ body: "Fala do vídeo", title: "Título", videoId: "v9", imageUrl: "https://i", linkUrl: "https://pag.com", callToAction: "SHOP_NOW", format: "video" });
  });
  it("publicação existente: guarda o id do post para buscar o texto", () => {
    const p = parseCreative({ effective_object_story_id: "123_456", thumbnail_url: "https://t" });
    expect(p.storyId).toBe("123_456");
    expect(p.body).toBeNull();
    expect(p.format).toBe("image");
  });
  it("entrada vazia não quebra", () => {
    expect(parseCreative(null).format).toBe("unknown");
  });
});
