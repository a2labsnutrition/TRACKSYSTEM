import type { BreakdownKey, BreakdownRow, EntityEvent, InsightDaily } from "@/lib/data/types";
import { addDays } from "@/lib/tz";

/**
 * Breakdowns FICTÍCIOS derivados dos insights diários de campanha do modo demo.
 * Cada segmento tem um peso de gasto e um multiplicador de conversão, para que
 * a análise de públicos mostre onde converte barato e onde queima dinheiro.
 */

interface Segment {
  value: string;
  spend: number; // peso no gasto
  conv: number; // multiplicador de conversão (1 = média)
  ctr?: number; // multiplicador de CTR
}

const AGE_GENDER: Segment[] = [
  { value: "18-24|female", spend: 0.07, conv: 0.5, ctr: 1.1 },
  { value: "25-34|female", spend: 0.2, conv: 1.45, ctr: 1.15 },
  { value: "35-44|female", spend: 0.22, conv: 1.55, ctr: 1.1 },
  { value: "45-54|female", spend: 0.14, conv: 1.05 },
  { value: "55-64|female", spend: 0.07, conv: 0.7, ctr: 0.9 },
  { value: "65+|female", spend: 0.03, conv: 0.35, ctr: 0.8 },
  { value: "18-24|male", spend: 0.04, conv: 0.2, ctr: 0.8 },
  { value: "25-34|male", spend: 0.08, conv: 0.45, ctr: 0.85 },
  { value: "35-44|male", spend: 0.07, conv: 0.55 },
  { value: "45-54|male", spend: 0.05, conv: 0.4 },
  { value: "55-64|male", spend: 0.02, conv: 0.2 },
  { value: "65+|male", spend: 0.01, conv: 0.1 },
];

const PLACEMENT: Segment[] = [
  { value: "instagram|feed", spend: 0.26, conv: 1.25, ctr: 1.1 },
  { value: "instagram|instagram_reels", spend: 0.24, conv: 1.15, ctr: 1.2 },
  { value: "instagram|instagram_stories", spend: 0.17, conv: 0.9 },
  { value: "facebook|feed", spend: 0.18, conv: 1.1 },
  { value: "facebook|facebook_reels", spend: 0.06, conv: 0.6 },
  { value: "audience_network|an_classic", spend: 0.09, conv: 0.05, ctr: 1.6 },
];

const DEVICE: Segment[] = [
  { value: "mobile_app", spend: 0.86, conv: 1.03 },
  { value: "mobile_web", spend: 0.06, conv: 0.6 },
  { value: "desktop", spend: 0.08, conv: 1.1 },
];

const REGION: Segment[] = [
  { value: "São Paulo", spend: 0.27, conv: 1.1 },
  { value: "Minas Gerais", spend: 0.11, conv: 1.05 },
  { value: "Rio de Janeiro", spend: 0.11, conv: 0.95 },
  { value: "Paraná", spend: 0.07, conv: 1.2 },
  { value: "Rio Grande do Sul", spend: 0.07, conv: 1.1 },
  { value: "Bahia", spend: 0.07, conv: 0.7 },
  { value: "Santa Catarina", spend: 0.05, conv: 1.3 },
  { value: "Goiás", spend: 0.05, conv: 1 },
  { value: "Pernambuco", spend: 0.05, conv: 0.6 },
  { value: "Mato Grosso", spend: 0.04, conv: 1.15 },
  { value: "Ceará", spend: 0.04, conv: 0.55 },
  { value: "Distrito Federal", spend: 0.07, conv: 1.05 },
];

// Curva de gasto por hora (madrugada barata e sem conversão; noite converte)
const HOUR: Segment[] = Array.from({ length: 24 }, (_, h) => {
  const spend = h < 6 ? 0.012 : h < 9 ? 0.035 : h < 12 ? 0.05 : h < 18 ? 0.05 : h < 23 ? 0.065 : 0.03;
  const conv = h < 6 ? 0.3 : h < 9 ? 0.8 : h < 18 ? 1 : h < 23 ? 1.35 : 0.9;
  return { value: String(h).padStart(2, "0"), spend, conv };
});

const SPECS: Array<{ key: BreakdownKey; segs: Segment[] }> = [
  { key: "age_gender", segs: AGE_GENDER },
  { key: "placement", segs: PLACEMENT },
  { key: "device", segs: DEVICE },
  { key: "region", segs: REGION },
  { key: "hour", segs: HOUR },
];

/** Distribui um total inteiro por pesos (maiores restos), somando exatamente o total. */
export function allocate(total: number, weights: number[]): number[] {
  const sumW = weights.reduce((a, b) => a + b, 0) || 1;
  const raw = weights.map((w) => (total * w) / sumW);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i] as const).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k][1]]++;
  return out;
}

export function demoBreakdowns(campaignRows: InsightDaily[]): BreakdownRow[] {
  const out: BreakdownRow[] = [];
  for (const r of campaignRows) {
    if (r.level !== "campaign" || r.spend <= 0) continue;
    for (const { key, segs } of SPECS) {
      const sw = segs.map((s) => s.spend);
      const cw = segs.map((s) => s.spend * s.conv);
      const kw = segs.map((s) => s.spend * (s.ctr ?? 1));
      const imp = allocate(r.impressions, sw);
      const reach = allocate(r.reach, sw);
      const clicks = allocate(r.linkClicks, kw);
      const lpv = allocate(r.landingPageViews, kw.map((w, i) => w * (segs[i].value.startsWith("audience_network") ? 0.3 : 1)));
      const ic = allocate(r.initiateCheckout, cw);
      const pur = allocate(Math.round(r.purchases), cw);
      const sumSw = sw.reduce((a, b) => a + b, 0);
      segs.forEach((s, i) => {
        out.push({
          breakdown: key,
          value: s.value,
          entityId: r.entityId,
          date: r.date,
          spend: Math.round(((r.spend * s.spend) / sumSw) * 100) / 100,
          impressions: imp[i],
          reach: reach[i],
          linkClicks: clicks[i],
          landingPageViews: lpv[i],
          initiateCheckout: ic[i],
          purchases: pur[i],
          purchaseValue: r.purchases ? Math.round(((r.purchaseValue * pur[i]) / r.purchases) * 100) / 100 : 0,
        });
      });
    }
  }
  return out;
}

export function demoEntityEvents(today: string, campaignIds: string[]): EntityEvent[] {
  const at = (daysAgo: number, h = 10) => `${addDays(today, -daysAgo)}T${String(h).padStart(2, "0")}:00:00-04:00`;
  const ev = (id: string, ci: number, daysAgo: number, eventType: string, label: string, source: EntityEvent["source"] = "meta_activity"): EntityEvent => ({
    id,
    campaignId: campaignIds[ci] ?? null,
    adsetId: null,
    adId: null,
    eventType,
    label,
    source,
    eventTime: new Date(at(daysAgo)).toISOString(),
  });
  return [
    ev("e1", 0, 12, "update_campaign_budget", "Orçamento da campanha alterado: R$ 180,00 → R$ 250,00"),
    ev("e2", 0, 20, "learning_success", "Saiu da fase de aprendizado (amplo_1)", "sync_detected"),
    ev("e3", 1, 6, "create_ad", "Anúncio criado (ugc02_v2)"),
    ev("e4", 1, 9, "update_ad_set_target_spec", "Público editado (interesses_2)"),
    ev("e5", 2, 15, "learning_fail", "Aprendizado limitado (lal1_1)", "sync_detected"),
    ev("e6", 3, 9, "create_campaign_group", "Campanha criada"),
    ev("e7", 4, 2, "create_campaign_group", "Campanha criada"),
  ];
}
