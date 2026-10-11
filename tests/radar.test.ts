import { describe, expect, it } from "vitest";
import { computeAlerts, type AlertInput } from "@/lib/alerts/engine";
import type { Ad, AdSet, Campaign, InsightDaily, Order } from "@/lib/data/types";
import { parseSearch, parseVideos, type YtVideo } from "@/lib/integrations/youtube";
import { AI_SUBNICHES } from "@/lib/radar/catalog";
import { dedupeHooks, hookScene, hooksFromVideos, parseHooks } from "@/lib/radar/hooks";
import { measureSubniches, publishedAfterIso, summarizeVideos, type RadarSnapshot, type SubnicheMeasure } from "@/lib/radar/measure";
import { findTag, metaTestsBySlug } from "@/lib/radar/meta";
import { computeRadarScore, demandValue, growthFor, isHot } from "@/lib/radar/score";
import { addDays } from "@/lib/tz";

const NOW = Date.parse("2026-10-10T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString();
const video = (id: string, channel: string, views: number, age: number): YtVideo => ({ id, title: `Vídeo ${id}`, channelId: channel, channelTitle: channel, publishedAt: daysAgo(age), views });

const measure = (slug: string, vpd: number, extra: Partial<SubnicheMeasure> = {}): SubnicheMeasure => ({
  slug,
  query: slug,
  error: null,
  videos: 30,
  viewsPerDay: vpd,
  medianViewsPerDay: Math.round(vpd / 30),
  channels: 20,
  top3Share: 0.4,
  topVideoShare: 0.2,
  topVideos: [],
  ...extra,
});
const snap = (date: string, items: SubnicheMeasure[]): RadarSnapshot => ({ date, measuredAt: `${date}T09:00:00Z`, windowDays: 14, items });

describe("etiqueta ia-<slug>", () => {
  const slugs = ["chatgpt-iniciantes", "chatgpt", "videos", "automacao-agentes"];
  it("acha a etiqueta com hífens em qualquer lugar do nome", () => {
    expect(findTag("[Curso] IA-ChatGPT-Iniciantes | v2", slugs)).toBe("chatgpt-iniciantes");
    expect(findTag("teste_ia-videos_c01", slugs)).toBe("videos");
  });
  it("prefere o slug mais longo", () => {
    expect(findTag("ia-chatgpt-iniciantes", slugs)).toBe("chatgpt-iniciantes");
    expect(findTag("ia-chatgpt_reels", slugs)).toBe("chatgpt");
  });
  it("aceita o formato da fila de Criativos (camelCase)", () => {
    expect(findTag("[meuCurso]_iaAutomacaoAgentes_amplo_c03_1010", slugs)).toBe("automacao-agentes");
  });
  it("não confunde com palavras que terminam em ia", () => {
    expect(findTag("midia-videos_c01", slugs)).toBeNull();
    expect(findTag("campanha sem etiqueta", slugs)).toBeNull();
    expect(findTag(null, slugs)).toBeNull();
  });
});

describe("parsers do YouTube", () => {
  it("lê ids e estatísticas, ignorando itens incompletos", () => {
    expect(parseSearch({ items: [{ id: { videoId: "a" } }, { id: { channelId: "x" } }, { id: { videoId: "a" } }] })).toEqual(["a"]);
    const v = parseVideos({ items: [{ id: "a", snippet: { title: "T", channelId: "c", channelTitle: "C", publishedAt: "2026-10-01T00:00:00Z" }, statistics: { viewCount: "123" } }, { id: "b" }] });
    expect(v).toHaveLength(1);
    expect(v[0].views).toBe(123);
  });
});

describe("medição", () => {
  it("soma views/dia, conta canais e mede concentração", () => {
    const m = summarizeVideos("x", "q", [video("1", "A", 10_000, 10), video("2", "A", 3_000, 3), video("3", "B", 500, 1), video("old", "C", 1e6, 40)], NOW);
    expect(m.videos).toBe(3); // o de 40 dias fica fora da janela
    expect(m.viewsPerDay).toBe(1000 + 1000 + 500);
    expect(m.channels).toBe(2);
    expect(m.topVideoShare).toBeCloseTo(0.4);
    expect(m.topVideos[0].viewsPerDay).toBe(1000);
  });
  it("publishedAfter sem milissegundos", () => {
    expect(publishedAfterIso(NOW, 14)).toBe("2026-09-26T12:00:00Z");
  });
  it("cota esgotada interrompe o resto sem novas chamadas", async () => {
    let calls = 0;
    const fetchImpl = (async () => {
      calls++;
      return new Response(JSON.stringify({ error: { errors: [{ reason: "quotaExceeded" }] } }), { status: 403 });
    }) as typeof fetch;
    const r = await measureSubniches(AI_SUBNICHES.slice(0, 5), "k", { now: NOW, fetchImpl, concurrency: 1 });
    expect(r.quotaExhausted).toBe(true);
    expect(r.errors).toBe(5);
    expect(calls).toBe(1);
  });
});

describe("crescimento e em alta", () => {
  const today = "2026-10-10";
  it("compara com a medição de ~7 dias antes", () => {
    const h = [snap(addDays(today, -7), [measure("x", 2000)]), snap(addDays(today, -1), [measure("x", 2500)]), snap(today, [measure("x", 3000)])];
    const g = growthFor("x", h);
    expect(g.pct).toBeCloseTo(0.5);
    expect(g.baseDate).toBe(addDays(today, -7));
    expect(isHot(measure("x", 3000), g)).toBe(true);
  });
  it("sem base de 6–9 dias, não há crescimento", () => {
    const g = growthFor("x", [snap(addDays(today, -2), [measure("x", 100)]), snap(today, [measure("x", 300)])]);
    expect(g.pct).toBeNull();
    expect(g.days).toBe(2);
  });
  it("um viral isolado não é tendência", () => {
    const h = [snap(addDays(today, -7), [measure("x", 2000)]), snap(today, [measure("x", 6000, { topVideoShare: 0.8 })])];
    expect(isHot(h[1].items[0], growthFor("x", h))).toBe(false);
  });
  it("vira alerta no motor de alertas", () => {
    const base: AlertInput = { campaigns: [], ads: [], accounts: [], health: { integrations: [], capiSent: 0, capiFailed: 0, ordersPaid: 0, ordersAttributed: 0 } as unknown as AlertInput["health"], dayElapsed: 0.5 };
    const a = computeAlerts({ ...base, radarHot: [{ slug: "videos", name: "Vídeos com IA", growthPct: 0.42, viewsPerDay: 5000 }] });
    expect(a).toHaveLength(1);
    expect(a[0].type).toBe("radar_em_alta");
    expect(a[0].dedupeKey).toBe("radar_em_alta|radar:videos");
    expect(a[0].href).toBe("/radar-ia?s=videos");
  });
});

describe("score com origem de cada parte", () => {
  const sub = AI_SUBNICHES.find((s) => s.slug === "videos")!;
  it("sem medição nem testes: só catálogo, marcado como parcial", () => {
    const s = computeRadarScore(sub, null, { pct: null, current: null, base: null, baseDate: null, days: 0 }, null);
    expect(s.partial).toBe(true);
    expect(s.components.filter((c) => c.value != null).every((c) => c.origin === "catalogo")).toBe(true);
    expect(s.total).not.toBeNull();
  });
  it("demanda em escala log", () => {
    expect(demandValue(100)).toBe(0);
    expect(demandValue(10_000)).toBe(67);
    expect(demandValue(1e6)).toBe(100);
  });
  it("teste no Meta com vendas entra como medido", () => {
    const meta = { slug: "videos", ads: [{ id: "a", name: "n", campaignId: "c", via: "anuncio" as const }], spend: 200, impressions: 10000, linkClicks: 150, ctr: 0.015, metaPurchases: 2, metaRevenue: 400, realSales: 2, realRevenue: 400, purchases: 2, revenue: 400, salesSource: "cakto" as const, cpa: 100, roas: 2, cpaLow: 30, cpaHigh: 800, fxMissingRows: 0, days: 5 };
    const s = computeRadarScore(sub, measure("videos", 10_000), { pct: 0.1, current: 10_000, base: 9_000, baseDate: "2026-10-03", days: 8 }, meta);
    const m = s.components.find((c) => c.key === "meta")!;
    expect(m.origin).toBe("meta");
    expect(m.value).toBe(100);
    expect(s.partial).toBe(false);
  });
});

describe("testes no Meta por subnicho", () => {
  it("agrupa por etiqueta (anúncio > conjunto > campanha) e usa vendas da Cakto", () => {
    const ads = [
      { id: "ad1", adsetId: "s1", campaignId: "c1", name: "criativo ia-videos 01" },
      { id: "ad2", adsetId: "s2", campaignId: "c1", name: "criativo 02" },
      { id: "ad3", adsetId: "s3", campaignId: "c2", name: "criativo 03" },
    ] as Ad[];
    const adsets = [{ id: "s2", name: "conj ia-videos" }, { id: "s3", name: "conj" }] as AdSet[];
    const campaigns = [{ id: "c2", name: "camp ia-imagens" }] as Campaign[];
    const ins = (id: string, spend: number, purchases: number) => ({ level: "ad", entityId: id, date: "2026-10-09", spend, impressions: 1000, linkClicks: 10, purchases, purchaseValue: purchases * 97 }) as InsightDaily;
    const orders = [{ status: "paid", adId: "ad1", grossAmount: 97, isOrderBump: false, isUpsell: false }, { status: "pending", adId: "ad2", grossAmount: 97, isOrderBump: false, isUpsell: false }] as Order[];
    const t = metaTestsBySlug({ slugs: ["videos", "imagens"], ads, adsets, campaigns, insights: [ins("ad1", 50, 1), ins("ad2", 50, 1), ins("ad3", 30, 0)], orders });
    const v = t.get("videos")!;
    expect(v.ads.map((a) => a.via)).toEqual(["anuncio", "conjunto"]);
    expect(v.spend).toBe(100);
    expect(v.salesSource).toBe("cakto");
    expect(v.purchases).toBe(1);
    expect(v.roas).toBeCloseTo(0.97);
    expect(t.get("imagens")!.purchases).toBe(0);
    expect(t.get("imagens")!.cpa).toBeNull();
  });
});

describe("banco de ganchos", () => {
  it("lê um gancho por linha (lista, aspas, duplicados)", () => {
    expect(parseHooks('1. "Você usa o ChatGPT errado"\n- Você usa o ChatGPT errado\n\n• Ninguém te contou isso sobre IA\ncurto')).toEqual(["Você usa o ChatGPT errado", "Ninguém te contou isso sobre IA"]);
  });
  it("não repete o que já está no banco", () => {
    expect(dedupeHooks([{ slug: "a", text: "Gancho Um aqui", source: "manual", reference: null }], [{ slug: "a", text: "gancho um aqui " }])).toEqual([]);
  });
  it("títulos do YouTube viram inspiração e a cena leva o ângulo ia-<slug>", () => {
    const m = measure("videos", 5000, { topVideos: [{ id: "abc", title: "Fiz um  vídeo com IA", channelTitle: "Canal", views: 1000, viewsPerDay: 500, publishedAt: daysAgo(2) }] });
    const [h] = hooksFromVideos(m);
    expect(h.text).toBe("Fiz um vídeo com IA");
    expect(h.source).toBe("youtube");
    const scene = hookScene(AI_SUBNICHES.find((s) => s.slug === "videos")!, h);
    expect(scene.angle).toBe("ia-videos");
    expect(scene.hook).toBe("Fiz um vídeo com IA");
    expect(scene.ratio).toBe("9:16");
  });
});
