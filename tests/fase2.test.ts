import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { fallbackParecer } from "@/lib/advisor/fallback";
import { ParecerSchema } from "@/lib/advisor/schema";
import { buildSnapshot } from "@/lib/advisor/snapshot";
import { computeAlerts, type AlertInput } from "@/lib/alerts/engine";
import { campaignDetail } from "@/lib/analytics";
import { analyzeAudience, audienceHighlights } from "@/lib/audience";
import { allocate, demoBreakdowns } from "@/lib/data/demo/breakdowns";
import { DemoRepository } from "@/lib/data/demo/repo";
import type { BreakdownRow, TrackingHealth } from "@/lib/data/types";
import { configFromProduct, DEFAULT_DECISION_CONFIG, evaluate, type WindowData } from "@/lib/decision/rules";
import { activityLabel, breakdownLabel, breakdownValue } from "@/lib/integrations/meta/breakdowns";
import { EMPTY_TOTALS } from "@/lib/metrics/compute";
import { resolvePeriod, todayIn } from "@/lib/tz";

const w = (meta: Partial<typeof EMPTY_TOTALS>, realPurchases = 0, realNetRevenue = 0): WindowData => ({
  meta: { ...EMPTY_TOTALS, ...meta },
  realPurchases,
  realNetRevenue,
});
const cfg = { ...DEFAULT_DECISION_CONFIG, targetCpa: 50, maxCpa: 80, minRoas: 1.5 };

describe("regras — Fase 2", () => {
  it("detecta saturação de público", () => {
    const r = evaluate({
      last1d: w({}),
      last3d: w({ spend: 300, impressions: 10000, reachSum: 3500, linkClicks: 200, landingPageViews: 170 }, 6, 540),
      prev4d: w({ spend: 300, impressions: 13000, reachSum: 9000, linkClicks: 260, landingPageViews: 220 }, 8, 720),
      last7d: w({ spend: 600, impressions: 23000, reachSum: 12500, linkClicks: 460, landingPageViews: 390 }, 14, 1260),
      trackingOk: true,
      config: cfg,
    });
    expect(r.signals.map((s) => s.code)).toContain("saturacao_publico");
  });

  it("fadiga vira atenção quando atinge metade dos anúncios (sem bloquear escala com CPA saudável)", () => {
    const base = {
      last1d: w({}),
      last3d: w({ spend: 150, impressions: 8000, reachSum: 7000, linkClicks: 150, landingPageViews: 130 }, 4, 360),
      last7d: w({ spend: 350, impressions: 20000, reachSum: 17000, linkClicks: 380, landingPageViews: 320 }, 9, 810),
      trackingOk: true,
      config: cfg,
    };
    const few = evaluate({ ...base, fatiguedAds: ["A"], activeAds: 5 });
    expect(few.signals.find((s) => s.code === "criativos_em_fadiga")?.severity).toBe("info");
    expect(few.status).toBe("escalar");
    const many = evaluate({ ...base, fatiguedAds: ["A", "B", "C"], activeAds: 4 });
    expect(many.signals.find((s) => s.code === "criativos_em_fadiga")?.severity).toBe("atencao");
    expect(many.status).toBe("escalar");
  });

  it("aplica ajustes por produto e orçamento mínimo de teste", () => {
    const c = configFromProduct({ netPerSale: 100, targetCpa: null, maxCpa: null, minRoas: null, rules: { killSpendMultiple: 3, minTestBudget: 300 } });
    expect(c.killSpendMultiple).toBe(3);
    const r = evaluate({ last1d: w({}), last3d: w({ spend: 100 }), last7d: w({ spend: 120, linkClicks: 40 }), trackingOk: true, config: c });
    expect(r.status).toBe("aguardar");
    expect(r.missingData?.replace(/\s/g, " ")).toContain("R$ 180,00");
  });
});

describe("breakdowns", () => {
  it("lê valores e rótulos", () => {
    expect(breakdownValue("age_gender", { age: "25-34", gender: "female" })).toBe("25-34|female");
    expect(breakdownValue("hour", { hourly_stats_aggregated_by_advertiser_time_zone: "13:00:00 - 13:59:59" })).toBe("13");
    expect(breakdownLabel("placement", "instagram|instagram_reels")).toBe("Instagram · Reels");
    expect(breakdownLabel("age_gender", "35-44|female")).toBe("Mulheres 35-44");
    expect(breakdownLabel("weekday", "1")).toBe("Segunda");
  });

  it("rótulo de atividade com valores de orçamento", () => {
    const l = activityLabel({ event_type: "update_campaign_budget", object_name: "Camp X", extra_data: JSON.stringify({ old_value: 18000, new_value: 25000 }) });
    expect(l).toBe("Orçamento da campanha alterado: R$ 180,00 → R$ 250,00 (Camp X)");
  });

  it("alocação soma exatamente o total", () => {
    const a = allocate(17, [0.2, 0.5, 0.3]);
    expect(a.reduce((x, y) => x + y, 0)).toBe(17);
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
  });
});

describe("análise de públicos", () => {
  const row = (value: string, spend: number, purchases: number): BreakdownRow => ({
    breakdown: "age_gender", value, entityId: "c1", date: "2026-10-01", spend, impressions: spend * 40, reach: spend * 30,
    linkClicks: spend, landingPageViews: Math.round(spend * 0.8), initiateCheckout: purchases * 3, purchases, purchaseValue: purchases * 97,
  });
  const rows = [row("25-34|female", 300, 10), row("35-44|female", 300, 9), row("25-34|male", 200, 2), row("18-24|male", 120, 0)];

  it("marca barato, caro e queima e agrega idade/gênero", () => {
    const tables = analyzeAudience(rows, [], 40);
    const ag = tables.find((t) => t.tab === "age_gender")!;
    expect(ag.segments.find((s) => s.value === "25-34|female")?.tag).toBe("barato");
    expect(ag.segments.find((s) => s.value === "25-34|male")?.tag).toBe("caro");
    expect(ag.segments.find((s) => s.value === "18-24|male")?.tag).toBe("queima");
    const gender = tables.find((t) => t.tab === "gender")!;
    expect(gender.segments.find((s) => s.value === "female")?.spend).toBe(600);
    const h = audienceHighlights(tables).join("\n");
    expect(h).toMatch(/queima dinheiro/);
    expect(h).toMatch(/converte barato/);
    expect(h).toMatch(/está caro/);
  });

  it("demo gera breakdowns coerentes com o total da campanha", async () => {
    const repo = new DemoRepository();
    const camps = await repo.campaigns();
    const today = todayIn("America/Cuiaba");
    const ins = await repo.insights({ level: "campaign", from: today, to: today, campaignId: camps[0].id });
    const bd = demoBreakdowns(ins).filter((r) => r.breakdown === "placement");
    const purchases = bd.reduce((s, r) => s + r.purchases, 0);
    expect(purchases).toBe(Math.round(ins[0].purchases));
  });
});

describe("alertas", () => {
  const health: TrackingHealth = {
    integrations: [
      { provider: "meta", status: "ok", label: "Meta", detail: "", lastEventAt: null, expiresAt: new Date(Date.now() + 3 * 86400000).toISOString() },
      { provider: "cakto", status: "error", label: "Webhook Cakto", detail: "parado", lastEventAt: null },
      { provider: "tracking", status: "ok", label: "Script", detail: "", lastEventAt: null },
    ],
    lastTrackingEventAt: null, lastCaktoEventAt: null, lastMetaSyncAt: null,
    ordersPaid: 20, ordersAttributed: 8, metaPurchases: 20, caktoPurchases: 20, capiSent: 100, capiFailed: 10, linkClicks: 0, landingPageViews: 0,
  };
  const input: AlertInput = {
    campaigns: [
      {
        id: "c1", name: "Camp 1", active: true, dailyBudget: 200, spendToday: 10, spend3d: 500,
        signals: [
          { code: "cpa_acima_max", severity: "critico", message: "CPA alto", evidence: {} },
          { code: "cpa_acima_alvo", severity: "atencao", message: "CPA acima", evidence: {} },
          { code: "frequencia_alta", severity: "atencao", message: "Freq", evidence: {} },
          { code: "cpa_saudavel", severity: "positivo", message: "ok", evidence: {} },
        ],
      },
      { id: "c2", name: "Pausada", active: false, dailyBudget: 100, spendToday: 0, spend3d: 0, signals: [{ code: "gasto_sem_venda", severity: "critico", message: "x", evidence: {} }] },
    ],
    ads: [{ id: "a1", name: "Anúncio X", campaignId: "c1", effectiveStatus: "DISAPPROVED" }],
    accounts: [{ id: "acc", name: "Conta", status: "Pagamento pendente" }],
    health,
    dayElapsed: 0.6,
  };

  it("gera os alertas esperados, um de CPA por campanha, ignorando pausadas", () => {
    const a = computeAlerts(input);
    const types = a.map((x) => x.type);
    expect(types.filter((t) => t === "cpa_acima_meta")).toHaveLength(1);
    expect(a.find((x) => x.type === "cpa_acima_meta")?.severity).toBe("critico");
    expect(types).toEqual(expect.arrayContaining(["frequencia_alta", "queda_entrega", "anuncio_reprovado", "conta_problema", "webhook_parado", "token_expirando", "capi_falhas", "atribuicao_baixa"]));
    expect(a.some((x) => x.entityId === "c2")).toBe(false);
    expect(a[0].severity).toBe("critico");
    expect(new Set(a.map((x) => x.dedupeKey)).size).toBe(a.length);
  });
});

describe("Parecer do Consultor", () => {
  it("schema é aceito pelo helper de saída estruturada", () => {
    expect(() => betaZodOutputFormat(ParecerSchema)).not.toThrow();
  });

  it("parecer automático (sem IA) é válido para todas as campanhas demo", async () => {
    const repo = new DemoRepository();
    const ctx = await repo.context();
    const period = resolvePeriod(ctx.workspace.timezone, "7d");
    const health = await repo.health();
    for (const c of await repo.campaigns()) {
      const d = await campaignDetail(repo, c.id, period);
      expect(d).not.toBeNull();
      const snap = buildSnapshot(d!, health, null, todayIn(ctx.workspace.timezone));
      const json = JSON.stringify(snap);
      expect(json).not.toContain("NaN");
      expect(snap.veredito_regras.status).toBe(d!.row.decision.status);
      const parecer = fallbackParecer(snap);
      expect(() => ParecerSchema.parse(parecer)).not.toThrow();
      expect(parecer.diagnostico).toHaveLength(3);
      expect(parecer.caminhos).toHaveLength(3);
      expect(parecer.plano.length).toBeGreaterThan(0);
    }
  });
});
