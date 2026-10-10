import type { Ad, AdSet, Campaign, InsightDaily, Order, PaymentMethod, Product } from "@/lib/data/types";
import { addDays } from "@/lib/tz";

/**
 * Gera dados FICTÍCIOS e determinísticos para o modo demo.
 * Cenários pensados para mostrar cada veredito do motor de decisão.
 */

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Profile {
  key: string;
  name: string;
  productId: string;
  price: number;
  startDaysAgo: number;
  dailyBudget: number;
  cpm: number;
  ctr: number;
  connect: number;
  checkout: number;
  purchase: number;
  hook: number;
  hold: number;
  /** multiplicador de CTR no fim (fadiga < 1) */
  ctrDecay: number;
  status: "ACTIVE" | "PAUSED";
  budgetType: "CBO" | "ABO";
}

const PROFILES: Profile[] = [
  { key: "c1", name: "[EmagrecePro]_dor-espelho_amplo_vid01_0108", productId: "p1", price: 97, startDaysAgo: 45, dailyBudget: 250, cpm: 22, ctr: 0.02, connect: 0.87, checkout: 0.12, purchase: 0.4, hook: 0.34, hold: 0.32, ctrDecay: 0.95, status: "ACTIVE", budgetType: "CBO" },
  { key: "c2", name: "[EmagrecePro]_prova-social_interesses_ugc02_1508", productId: "p1", price: 97, startDaysAgo: 30, dailyBudget: 120, cpm: 26, ctr: 0.022, connect: 0.82, checkout: 0.1, purchase: 0.46, hook: 0.27, hold: 0.25, ctrDecay: 0.62, status: "ACTIVE", budgetType: "ABO" },
  { key: "c3", name: "[ReceitasFit]_ugc_lookalike_img03_2008", productId: "p2", price: 47, startDaysAgo: 25, dailyBudget: 90, cpm: 19, ctr: 0.016, connect: 0.55, checkout: 0.16, purchase: 0.6, hook: 0.22, hold: 0.2, ctrDecay: 0.9, status: "ACTIVE", budgetType: "ABO" },
  { key: "c4", name: "[MentoriaVIP]_autoridade_amplo_vid04_2809", productId: "p3", price: 497, startDaysAgo: 9, dailyBudget: 150, cpm: 31, ctr: 0.009, connect: 0.8, checkout: 0.03, purchase: 0.02, hook: 0.18, hold: 0.2, ctrDecay: 1, status: "ACTIVE", budgetType: "CBO" },
  { key: "c5", name: "[ReceitasFit]_curiosidade_amplo_vid05_0710", productId: "p2", price: 47, startDaysAgo: 2, dailyBudget: 40, cpm: 18, ctr: 0.015, connect: 0.84, checkout: 0.08, purchase: 0.3, hook: 0.3, hold: 0.28, ctrDecay: 1, status: "ACTIVE", budgetType: "ABO" },
  { key: "c6", name: "[EmagrecePro]_teste-antigo_interesses_img06_0107", productId: "p1", price: 97, startDaysAgo: 80, dailyBudget: 0, cpm: 24, ctr: 0.011, connect: 0.8, checkout: 0.07, purchase: 0.3, hook: 0.2, hold: 0.2, ctrDecay: 0.8, status: "PAUSED", budgetType: "ABO" },
];

export const DEMO_PRODUCTS: Product[] = [
  { id: "p1", name: "EmagrecePro (curso)", price: 97, netPerSale: 89.5, targetCpa: null, maxCpa: null, minRoas: null, caktoProductIds: ["demo_prod_1"], kind: "principal", costPerSale: 2, costPct: 0 },
  { id: "p2", name: "Receitas Fit (e-book)", price: 47, netPerSale: 43.3, targetCpa: null, maxCpa: null, minRoas: null, caktoProductIds: ["demo_prod_2"], kind: "principal", costPerSale: 0, costPct: 0 },
  { id: "p3", name: "Mentoria VIP", price: 497, netPerSale: 462, targetCpa: null, maxCpa: 350, minRoas: null, caktoProductIds: ["demo_prod_3"], kind: "principal", costPerSale: 40, costPct: 0.1 },
  { id: "p4", name: "Guia de Lanches (order bump)", price: 19.9, netPerSale: 18.1, targetCpa: null, maxCpa: null, minRoas: null, caktoProductIds: ["demo_bump_1"], kind: "order_bump", costPerSale: 0, costPct: 0 },
];

const BUMP_PRICE = 19.9;

export interface DemoData {
  campaigns: Campaign[];
  adsets: AdSet[];
  ads: Ad[];
  insights: InsightDaily[];
  orders: Order[];
}

export const demoCampaignId = (ci: number) => `2385${ci}0000000000${ci}`;

const AUDIENCES = ["Amplo · 25–54 · Brasil · Advantage+", "Interesses: dieta, academia · 25–44", "Lookalike 1% compradores · 25–54", "Remarketing 30d (visitantes LP)"];
const HOOKS = [
  "Você se olha no espelho e não se reconhece?",
  "Eu perdi 9 kg sem cortar o pão. Vou te mostrar como.",
  "Pare de fazer dieta da moda (o motivo vai te surpreender)",
  "3 erros que travam seu emagrecimento depois dos 30",
  "O que eu como em um dia para secar sem passar fome",
];

export function generateDemo(today: string, accountId = "demo-account"): DemoData {
  const rnd = mulberry32(20261009);
  // Arredondamento estocástico: mantém o valor esperado em contagens pequenas.
  const sr = (x: number) => Math.floor(x) + (rnd() < x - Math.floor(x) ? 1 : 0);
  const campaigns: Campaign[] = [];
  const adsets: AdSet[] = [];
  const ads: Ad[] = [];
  const insights: InsightDaily[] = [];
  const orders: Order[] = [];
  let orderSeq = 1000;

  PROFILES.forEach((p, ci) => {
    const campaignId = demoCampaignId(ci);
    campaigns.push({
      id: campaignId,
      adAccountId: accountId,
      name: p.name,
      status: p.status,
      effectiveStatus: p.status,
      objective: "OUTCOME_SALES",
      dailyBudget: p.budgetType === "CBO" ? p.dailyBudget : null,
      lifetimeBudget: null,
      budgetType: p.budgetType,
      bidStrategy: "LOWEST_COST_WITHOUT_CAP",
      createdTime: `${addDays(today, -p.startDaysAgo)}T12:00:00-0300`,
      productId: p.productId,
    });
    const nAdsets = ci === 4 ? 1 : 2;
    for (let s = 0; s < nAdsets; s++) {
      const adsetId = `${campaignId}1${s}`;
      adsets.push({
        id: adsetId,
        campaignId,
        name: `${p.name.split("_")[0]}_${["amplo", "interesses", "lal1", "rmkt"][(ci + s) % 4]}_${s + 1}`,
        status: p.status,
        effectiveStatus: p.status,
        optimizationGoal: "OFFSITE_CONVERSIONS",
        dailyBudget: p.budgetType === "ABO" ? Math.round(p.dailyBudget / nAdsets) : null,
        lifetimeBudget: null,
        bidStrategy: "LOWEST_COST_WITHOUT_CAP",
        learningStage: ci === 4 || ci === 3 ? "LEARNING" : "SUCCESS",
        createdTime: `${addDays(today, -p.startDaysAgo)}T12:00:00-0300`,
        targetingSummary: AUDIENCES[(ci + s) % AUDIENCES.length],
      });
      const nAds = ci === 4 ? 2 : 3;
      for (let a = 0; a < nAds; a++) {
        const adId = `${adsetId}2${a}`;
        const isVideo = (ci + a) % 3 !== 2;
        const hook = HOOKS[(ci * 2 + a) % HOOKS.length];
        ads.push({
          id: adId,
          adsetId,
          campaignId,
          name: `${p.name.split("_").slice(0, 2).join("_")}_${isVideo ? "vid" : "img"}${String(a + 1).padStart(2, "0")}`,
          status: p.status,
          effectiveStatus: p.status,
          createdTime: `${addDays(today, -p.startDaysAgo)}T12:00:00-0300`,
          creative: {
            id: `cr${adId}`,
            title: p.name.includes("Receitas") ? "Receitas Fit: 120 receitas em 15 min" : p.name.includes("Mentoria") ? "Mentoria VIP: 8 semanas comigo" : "EmagrecePro: método de 21 dias",
            body: `${hook}\n\nConheça o método que já ajudou +3.000 alunas. Garantia de 7 dias.`,
            callToAction: "LEARN_MORE",
            thumbnailUrl: null,
            imageUrl: null,
            videoId: isVideo ? `v${adId}` : null,
            linkUrl: "https://exemplo-demo.com/oferta",
            format: isVideo ? "video" : "image",
          },
        });

        // Peso do anúncio dentro do conjunto (vencedor e perdedor)
        const weight = [0.55, 0.3, 0.15][a] ?? 0.2;
        const quality = [1.15, 0.95, 0.7][a] ?? 1;
        for (let d = p.startDaysAgo; d >= 0; d--) {
          const date = addDays(today, -d);
          if (p.status === "PAUSED" && d < 20) continue;
          const progress = 1 - d / Math.max(1, p.startDaysAgo);
          const isToday = d === 0;
          const dayFrac = isToday ? 0.55 : 1;
          const noise = 0.8 + rnd() * 0.4;
          const budget = (p.dailyBudget || 100) / nAdsets;
          const spend = round2(budget * weight * noise * dayFrac);
          const cpm = p.cpm * (1 + progress * 0.15) * (0.9 + rnd() * 0.2);
          const impressions = Math.round((spend / cpm) * 1000);
          const freqBase = 1.1 + progress * (p.ctrDecay < 0.8 ? 2.6 : 1.1);
          const reach = Math.round(impressions / freqBase);
          const ctr = p.ctr * quality * (1 - (1 - p.ctrDecay) * progress) * (0.85 + rnd() * 0.3);
          const linkClicks = sr(impressions * ctr);
          const clicks = Math.round(linkClicks * (1.3 + rnd() * 0.3));
          const lpv = sr(linkClicks * p.connect * (0.92 + rnd() * 0.1));
          const ic = sr(lpv * p.checkout * quality * (0.8 + rnd() * 0.4));
          const api = sr(ic * 0.7);
          const purchases = Math.min(ic, sr(ic * p.purchase * (0.7 + rnd() * 0.6)));
          const video3s = isVideo ? Math.round(impressions * p.hook * quality * (1 - (1 - p.ctrDecay) * progress * 0.8)) : 0;
          const thruplay = Math.round(video3s * p.hold);
          insights.push({
            level: "ad",
            entityId: adId,
            adAccountId: accountId,
            campaignId,
            adsetId,
            date,
            spend,
            impressions,
            reach,
            clicks,
            linkClicks,
            landingPageViews: lpv,
            initiateCheckout: ic,
            addPaymentInfo: api,
            purchases,
            purchaseValue: round2(purchases * p.price),
            video3s,
            thruplay,
            videoP25: Math.round(video3s * 0.6),
            videoP50: Math.round(video3s * 0.38),
            videoP75: Math.round(video3s * 0.22),
            videoP95: Math.round(video3s * 0.12),
            videoP100: Math.round(video3s * 0.09),
            videoAvgTimeSec: isVideo ? round2(6 + rnd() * 8) : null,
            qualityRanking: a === 2 ? "BELOW_AVERAGE_35" : "AVERAGE",
            engagementRanking: a === 0 ? "ABOVE_AVERAGE" : "AVERAGE",
            conversionRanking: "AVERAGE",
          });

          // Pedidos reais (Cakto): parte das compras do Meta + Pix não pagos + vendas não atribuídas
          const realPaid = Math.max(0, purchases - (rnd() < 0.1 ? 1 : 0));
          const pendingPix = ic > purchases && rnd() < 0.3 ? 1 : 0;
          const product = DEMO_PRODUCTS.find((x) => x.id === p.productId)!;
          for (let k = 0; k < realPaid + pendingPix; k++) {
            const paid = k < realPaid;
            const method: PaymentMethod = !paid ? "pix" : rnd() < 0.55 ? "pix" : rnd() < 0.9 ? "credit_card" : "boleto";
            const hour = 8 + Math.floor(rnd() * 14);
            const minute = Math.floor(rnd() * 60);
            const createdAt = `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-04:00`;
            const attributed = rnd() < 0.92;
            const methodAttr = attributed ? (rnd() < 0.8 ? "checkout_param" : rnd() < 0.5 ? "fbclid" : "email_hash") : "unattributed";
            // ~35% das compras do EmagrecePro levam o order bump no mesmo pedido
            const bump = p.productId === "p1" && rnd() < 0.35 ? BUMP_PRICE : 0;
            const gross = round2(p.price + bump);
            const fee = round2(gross * (method === "credit_card" ? 0.0799 : 0.0599) + 0.99);
            const refunded = paid && rnd() < 0.03;
            orders.push({
              id: `o${orderSeq}`,
              externalId: `DEMO-${orderSeq++}`,
              productId: product.id,
              productName: product.name,
              status: refunded ? "refunded" : paid ? "paid" : "pending",
              paymentMethod: method,
              grossAmount: gross,
              fees: fee,
              netAmount: round2(gross - fee),
              currency: "BRL",
              coupon: null,
              isOrderBump: false,
              isUpsell: false,
              orderKind: "main",
              mainAmount: p.price,
              bumpAmount: bump,
              upsellAmount: 0,
              customerEmail: `cliente${orderSeq}@exemplo.com`,
              createdAt: new Date(createdAt).toISOString(),
              paidAt: paid ? new Date(createdAt).toISOString() : null,
              refundedAt: refunded ? new Date(createdAt).toISOString() : null,
              utmSource: attributed ? "facebook" : null,
              utmMedium: attributed ? "paid" : null,
              utmCampaign: attributed ? `${p.name}|${campaignId}` : null,
              utmContent: attributed ? `ad|${adId}` : null,
              utmTerm: attributed ? `adset|${adsetId}` : null,
              campaignId: attributed ? campaignId : null,
              adsetId: attributed ? adsetId : null,
              adId: attributed ? adId : null,
              attributionMethod: methodAttr,
              attributionConfidence: attributed ? (methodAttr === "checkout_param" ? 0.95 : methodAttr === "fbclid" ? 0.85 : 0.7) : 0,
              capiPurchaseSentAt: paid ? new Date(createdAt).toISOString() : null,
            });
          }
        }
      }
    }
  });

  // Agrega nível conjunto, campanha e conta a partir do nível anúncio
  const agg = (level: "adset" | "campaign" | "account", keyOf: (r: InsightDaily) => string) => {
    const m = new Map<string, InsightDaily>();
    for (const r of insights.filter((x) => x.level === "ad")) {
      const k = `${keyOf(r)}|${r.date}`;
      const cur = m.get(k);
      if (!cur) {
        m.set(k, {
          ...r,
          level,
          entityId: keyOf(r),
          adsetId: level === "adset" ? r.adsetId : null,
          campaignId: level === "account" ? null : r.campaignId,
          qualityRanking: null,
          engagementRanking: null,
          conversionRanking: null,
        });
      } else {
        for (const f of NUM_FIELDS) (cur[f] as number) += r[f] as number;
        cur.spend = round2(cur.spend);
        cur.purchaseValue = round2(cur.purchaseValue);
      }
    }
    return [...m.values()];
  };
  const adsetRows = agg("adset", (r) => r.adsetId!);
  const campaignRows = agg("campaign", (r) => r.campaignId!);
  const accountRows = agg("account", () => "act_demo");
  insights.push(...adsetRows, ...campaignRows, ...accountRows);

  return { campaigns, adsets, ads, insights, orders };
}

const NUM_FIELDS: Array<keyof InsightDaily> = [
  "spend",
  "impressions",
  "reach",
  "clicks",
  "linkClicks",
  "landingPageViews",
  "initiateCheckout",
  "addPaymentInfo",
  "purchases",
  "purchaseValue",
  "video3s",
  "thruplay",
  "videoP25",
  "videoP50",
  "videoP75",
  "videoP95",
  "videoP100",
];

function round2(v: number) {
  return Math.round(v * 100) / 100;
}
