import { describe, expect, it } from "vitest";
import { detectAnomalies, possibleDuplicateOrders, type AnomalyDay } from "@/lib/anomalies";
import { analyzeCreatives, type CreativeInput } from "@/lib/creative/intelligence";
import type { AdAccount, InsightDaily, Order, TrackingHealth } from "@/lib/data/types";
import { hostMatches, processCollect, rateLimited } from "@/lib/ingest/collect";
import { parsePtax, ptaxUrl } from "@/lib/integrations/bcb/ptax";
import { redact, redactText } from "@/lib/log";
import { EMPTY_TOTALS } from "@/lib/metrics/compute";
import { applyFx, fxFor, fxTableFromRows } from "@/lib/money/fx";
import { addDays } from "@/lib/tz";
import { makeStore } from "./helpers";

// ------------------------------ criativos ------------------------------

const ad = (id: string, spend: number, purchases: number, extra: Partial<typeof EMPTY_TOTALS> = {}): CreativeInput => ({
  id,
  name: id,
  status: "ACTIVE",
  meta: { ...EMPTY_TOTALS, spend, impressions: spend * 40, linkClicks: spend * 0.6, ...extra },
  purchases,
  confirmed: purchases,
  revenue: purchases * 97,
  fatigue: null,
});

describe("inteligência de criativos", () => {
  it("gasto alto não vira 'vencedor'; vendas sem origem não vão para o de maior gasto", () => {
    const r = analyzeCreatives([ad("A", 65, 0), ad("B", 12.5, 0), ad("C", 10, 0), ad("D", 7.5, 0), ad("E", 5, 0)], { maxCpa: 90, unattributed: 3 });
    const a = r.ads.find((x) => x.id === "A")!;
    expect(a.purchases).toBe(0);
    expect(a.verdict).not.toBe("destaque_comprovado");
    expect(a.distributionNote).toMatch(/previsão do algoritmo/);
    expect(a.distributionNote).toMatch(/NÃO foram atribuídas a ele/);
    expect(r.tests[0].title).toMatch(/Teste controlado/);
  });

  it("destaque só com teste estatístico robusto às vendas sem origem", () => {
    const strong = analyzeCreatives([ad("A", 500, 20), ad("B", 500, 3)], { maxCpa: 80, unattributed: 0 });
    expect(strong.ads.find((x) => x.id === "A")!.verdict).toBe("destaque_comprovado");
    expect(strong.ads.find((x) => x.id === "B")!.verdict).toBe("abaixo_comprovado");
    // com muitas vendas sem origem, a mesma diferença deixa de ser comprovada
    const unsure = analyzeCreatives([ad("A", 500, 20), ad("B", 500, 3)], { maxCpa: 80, unattributed: 15 });
    expect(unsure.ads.find((x) => x.id === "A")!.verdict).not.toBe("destaque_comprovado");
    expect(unsure.ads.find((x) => x.id === "B")!.verdict).not.toBe("abaixo_comprovado");
  });

  it("pouco gasto sem venda é 'pouco gasto', não 'perdedor'", () => {
    const r = analyzeCreatives([ad("A", 20, 0), ad("B", 300, 5)], { maxCpa: 80, unattributed: 0 });
    expect(r.ads.find((x) => x.id === "A")!.verdict).toBe("pouco_gasto");
  });

  it("gasto sem venda improvável por acaso (sem vendas sem origem)", () => {
    const r = analyzeCreatives([ad("A", 300, 0), ad("B", 300, 6)], { maxCpa: 80, unattributed: 0 });
    expect(r.ads.find((x) => x.id === "A")!.verdict).toBe("gasto_sem_venda");
  });
});

// ------------------------------ anomalias ------------------------------

const health = (over: Partial<TrackingHealth> = {}): TrackingHealth => ({
  integrations: [],
  lastTrackingEventAt: new Date().toISOString(),
  lastCaktoEventAt: new Date().toISOString(),
  lastMetaSyncAt: new Date().toISOString(),
  ordersPaid: 0,
  ordersAttributed: 0,
  metaPurchases: 0,
  caktoPurchases: 0,
  capiSent: 0,
  capiFailed: 0,
  linkClicks: 0,
  landingPageViews: 0,
  ...over,
});

function days(n: number, last: string, f: (i: number) => Partial<AnomalyDay>): AnomalyDay[] {
  return Array.from({ length: n }, (_, i) => ({
    date: addDays(last, i - n + 1),
    spend: 300,
    impressions: 12000,
    linkClicks: 200,
    landingPageViews: 160,
    initiateCheckout: 16,
    metaPurchases: 6,
    metaPurchaseValue: 582,
    purchases: 6,
    attributedRevenue: 560,
    ...f(i),
  }));
}

describe("anomalias", () => {
  const last = "2026-10-09";
  it("variação normal não vira anomalia", () => {
    const ds = days(18, last, (i) => ({ spend: 300 + (i % 3) * 10, purchases: 5 + (i % 3) }));
    const r = detectAnomalies({ days: ds, health: health(), orders: [], lastFullDay: last });
    expect(r.filter((c) => c.status === "anomalia")).toHaveLength(0);
    expect(r.find((c) => c.code === "conversao")?.status).toBe("normal");
    expect(r.find((c) => c.code === "cpm")?.status).toBe("normal");
  });

  it("queda real de conversão e salto de CPM são anomalias", () => {
    const ds = days(18, last, (i) => (i >= 15 ? { purchases: 0, impressions: i === 17 ? 6000 : 12000 } : {}));
    const r = detectAnomalies({ days: ds, health: health(), orders: [], lastFullDay: last });
    expect(r.find((c) => c.code === "conversao")?.status).toBe("anomalia");
    expect(r.find((c) => c.code === "cpm")?.status).toBe("anomalia");
  });

  it("sem base suficiente: não chuta", () => {
    const r = detectAnomalies({ days: days(3, last, () => ({})), health: health(), orders: [], lastFullDay: last });
    expect(r.find((c) => c.code === "conversao")?.status).toBe("sem_dados");
  });

  it("webhook parado com atividade no Meta e sync atrasado", () => {
    const old = new Date(Date.now() - 40 * 3600000).toISOString();
    const r = detectAnomalies({ days: days(18, last, () => ({})), health: health({ lastCaktoEventAt: old, lastMetaSyncAt: old }), orders: [], lastFullDay: last });
    expect(r.find((c) => c.code === "webhook_cakto")?.status).toBe("anomalia");
    expect(r.find((c) => c.code === "sync_meta")?.severity).toBe("critico");
  });

  it("detecta possíveis pedidos duplicados (IDs diferentes, mesmo e-mail/valor em minutos)", () => {
    const o = (id: string, at: string): Order =>
      ({ id, externalId: id, productId: "p1", status: "paid", grossAmount: 97, customerEmail: "a@b.com", createdAt: at, paidAt: at, isOrderBump: false, isUpsell: false }) as Order;
    expect(possibleDuplicateOrders([o("X1", "2026-10-09T10:00:00Z"), o("X2", "2026-10-09T10:05:00Z")])).toHaveLength(1);
    expect(possibleDuplicateOrders([o("X1", "2026-10-09T10:00:00Z"), o("X2", "2026-10-09T11:05:00Z")])).toHaveLength(0);
  });
});

// ------------------------------ câmbio ------------------------------

describe("câmbio", () => {
  const usd: AdAccount = { id: "a1", metaAccountId: "act_1", name: "USD", currency: "USD", timezone: "America/Sao_Paulo", status: "", lastSyncedAt: null, fxMode: "auto", fxSpreadPct: 0.035 };
  const row = (date: string, spend: number) => ({ ...EMPTY_TOTALS, level: "account", entityId: "act_1", adAccountId: "a1", campaignId: null, adsetId: null, date, spend, reach: 0, videoAvgTimeSec: null, qualityRanking: null, engagementRanking: null, conversionRanking: null }) as unknown as InsightDaily;

  it("PTAX + IOF/spread, usando a última cotação disponível (fim de semana)", () => {
    const table = fxTableFromRows([{ date: "2026-10-09", base: "USD", rate: 5.4 }]);
    const fx = fxFor(usd, table, "2026-10-11");
    expect(fx.source).toBe("ptax");
    expect(fx.rateDate).toBe("2026-10-09");
    expect(fx.rate).toBeCloseTo(5.4 * 1.035, 6);
  });

  it("sem cotação: marca fxMissing e NÃO converte (nunca US$ como R$)", () => {
    const [r] = applyFx([row("2026-10-09", 20)], new Map([["a1", usd]]), new Map());
    expect(r.fxMissing).toBe(true);
    expect(r.spendOriginal).toBe(20);
  });

  it("parser da PTAX prefere o boletim de fechamento e monta a URL no formato do BCB", () => {
    const rates = parsePtax({
      value: [
        { cotacaoVenda: 5.41, dataHoraCotacao: "2026-10-09 10:08:00.000", tipoBoletim: "Abertura" },
        { cotacaoVenda: 5.44, dataHoraCotacao: "2026-10-09 13:09:00.000", tipoBoletim: "Fechamento PTAX" },
        { cotacaoVenda: 5.43, dataHoraCotacao: "2026-10-09 12:09:00.000", tipoBoletim: "Intermediário" },
      ],
    });
    expect(rates).toEqual([{ date: "2026-10-09", rate: 5.44 }]);
    expect(ptaxUrl("usd", "2026-10-01", "2026-10-09")).toContain("%27USD%27");
    expect(ptaxUrl("usd", "2026-10-01", "2026-10-09")).toContain("%2710-01-2026%27");
  });
});

// ------------------------------ segurança ------------------------------

describe("logs sem segredos", () => {
  it("mascara tokens do Meta, chaves, Bearer, JWT e access_token em URLs", () => {
    const t = redactText("GET https://graph.facebook.com/v26.0/me?access_token=EAAB1234567890abcdefghijklmnop&x=1 Bearer abc.def sk-ant-api03-xyz123456");
    expect(t).not.toMatch(/EAAB1234567890/);
    expect(t).not.toMatch(/sk-ant-api03-xyz/);
    expect(t).toContain("access_token=***");
    expect(t).toContain("Bearer ***");
    const o = redact({ accessToken: "segredo", nested: { webhookSecret: "x", ok: "texto" }, list: ["EAAB1234567890abcdefghijklmnop"] }) as Record<string, unknown>;
    expect(o.accessToken).toBe("***");
    expect((o.nested as Record<string, unknown>).webhookSecret).toBe("***");
    expect((o.nested as Record<string, unknown>).ok).toBe("texto");
    expect(JSON.stringify(o)).not.toMatch(/EAAB1234567890/);
  });
});

describe("coleta: domínio e limite de taxa", () => {
  it("aceita o domínio e subdomínios; rejeita outros", () => {
    expect(hostMatches("minhapagina.com", "https://www.minhapagina.com/oferta")).toBe(true);
    expect(hostMatches("minhapagina.com", "https://lp.minhapagina.com/")).toBe(true);
    expect(hostMatches("minhapagina.com", "https://minhapagina.com.golpe.io/")).toBe(false);
    expect(hostMatches("minhapagina.com", null)).toBe(null);
  });

  it("evento vindo de outro domínio é recusado (403)", async () => {
    const store = makeStore({ capi: false });
    const r = await processCollect(store, { site: "site_pub_1", event: "PageView", event_id: "pv_x1", sid: "s99999", url: "https://outro-site.com/" }, { ip: null, userAgent: null });
    expect(r.status).toBe(403);
    const ok = await processCollect(store, { site: "site_pub_1", event: "PageView", event_id: "pv_x2", sid: "s99999", url: "https://minhapagina.com/oferta" }, { ip: null, userAgent: null });
    expect(ok.status).not.toBe(403);
  });

  it("limita rajadas por IP+site", () => {
    const t0 = 1_000_000;
    let blocked = false;
    for (let i = 0; i < 130; i++) blocked = rateLimited("1.2.3.4|siteX", t0 + i);
    expect(blocked).toBe(true);
    expect(rateLimited("1.2.3.4|siteX", t0 + 61_000)).toBe(false);
  });
});
