import type { InsightDaily, Level } from "@/lib/data/types";
import { toNumber } from "@/lib/utils";

/**
 * Campos de insights pedidos à Marketing API e parser das "actions".
 * O Meta reporta funil em arrays `actions`/`action_values` com action_type
 * variando por configuração (pixel, omni, offsite_conversion...). O parser
 * aceita qualquer um dos aliases abaixo, na ordem de preferência.
 */

export const INSIGHT_FIELDS = [
  "date_start",
  "date_stop",
  "account_id",
  "campaign_id",
  "adset_id",
  "ad_id",
  "spend",
  "impressions",
  "reach",
  "frequency",
  "clicks",
  "inline_link_clicks",
  "actions",
  "action_values",
  "video_thruplay_watched_actions",
  "video_p25_watched_actions",
  "video_p50_watched_actions",
  "video_p75_watched_actions",
  "video_p95_watched_actions",
  "video_p100_watched_actions",
  "video_avg_time_watched_actions",
  "quality_ranking",
  "engagement_rate_ranking",
  "conversion_rate_ranking",
];

/** Rankings só existem no nível de anúncio. */
export function fieldsForLevel(level: Level): string {
  const base = INSIGHT_FIELDS.filter((f) => level === "ad" || !f.endsWith("_ranking"));
  return base.join(",");
}

const ALIASES = {
  landingPageViews: ["landing_page_view", "omni_landing_page_view"],
  initiateCheckout: ["offsite_conversion.fb_pixel_initiate_checkout", "omni_initiated_checkout", "initiate_checkout", "onsite_web_initiate_checkout"],
  addPaymentInfo: ["offsite_conversion.fb_pixel_add_payment_info", "omni_add_payment_info", "add_payment_info"],
  purchases: ["offsite_conversion.fb_pixel_purchase", "omni_purchase", "purchase", "onsite_web_purchase"],
  video3s: ["video_view"],
  linkClicks: ["link_click"],
};

type ActionList = Array<{ action_type?: string; value?: string | number }> | undefined;

export function actionValue(list: ActionList, aliases: string[]): number {
  if (!Array.isArray(list)) return 0;
  for (const a of aliases) {
    const hit = list.find((x) => x.action_type === a);
    if (hit) return toNumber(hit.value);
  }
  return 0;
}

export interface RawInsight {
  date_start: string;
  campaign_id?: string;
  adset_id?: string;
  ad_id?: string;
  account_id?: string;
  spend?: string;
  impressions?: string;
  reach?: string;
  clicks?: string;
  inline_link_clicks?: string;
  actions?: ActionList;
  action_values?: ActionList;
  video_thruplay_watched_actions?: ActionList;
  video_p25_watched_actions?: ActionList;
  video_p50_watched_actions?: ActionList;
  video_p75_watched_actions?: ActionList;
  video_p95_watched_actions?: ActionList;
  video_p100_watched_actions?: ActionList;
  video_avg_time_watched_actions?: ActionList;
  quality_ranking?: string;
  engagement_rate_ranking?: string;
  conversion_rate_ranking?: string;
}

function firstValue(list: ActionList): number {
  if (!Array.isArray(list) || list.length === 0) return 0;
  return toNumber(list[0].value);
}

function ranking(v: string | undefined): string | null {
  if (!v || v === "UNKNOWN") return null;
  return v;
}

export function parseInsight(raw: RawInsight, level: Level): InsightDaily {
  const entityId =
    level === "ad" ? raw.ad_id : level === "adset" ? raw.adset_id : level === "campaign" ? raw.campaign_id : raw.account_id;
  const linkClicks = toNumber(raw.inline_link_clicks) || actionValue(raw.actions, ALIASES.linkClicks);
  return {
    level,
    entityId: String(entityId ?? ""),
    campaignId: raw.campaign_id ?? null,
    adsetId: raw.adset_id ?? null,
    date: raw.date_start,
    spend: toNumber(raw.spend),
    impressions: toNumber(raw.impressions),
    reach: toNumber(raw.reach),
    clicks: toNumber(raw.clicks),
    linkClicks,
    landingPageViews: actionValue(raw.actions, ALIASES.landingPageViews),
    initiateCheckout: actionValue(raw.actions, ALIASES.initiateCheckout),
    addPaymentInfo: actionValue(raw.actions, ALIASES.addPaymentInfo),
    purchases: actionValue(raw.actions, ALIASES.purchases),
    purchaseValue: actionValue(raw.action_values, ALIASES.purchases),
    video3s: actionValue(raw.actions, ALIASES.video3s),
    thruplay: firstValue(raw.video_thruplay_watched_actions),
    videoP25: firstValue(raw.video_p25_watched_actions),
    videoP50: firstValue(raw.video_p50_watched_actions),
    videoP75: firstValue(raw.video_p75_watched_actions),
    videoP95: firstValue(raw.video_p95_watched_actions),
    videoP100: firstValue(raw.video_p100_watched_actions),
    videoAvgTimeSec: Array.isArray(raw.video_avg_time_watched_actions) && raw.video_avg_time_watched_actions.length
      ? firstValue(raw.video_avg_time_watched_actions)
      : null,
    qualityRanking: ranking(raw.quality_ranking),
    engagementRanking: ranking(raw.engagement_rate_ranking),
    conversionRanking: ranking(raw.conversion_rate_ranking),
  };
}

/** Valores de orçamento do Meta vêm em centavos (unidade mínima da moeda). */
export function budgetFromMeta(v: string | number | undefined | null): number | null {
  if (v === undefined || v === null || v === "" || v === "0") return null;
  const n = toNumber(v);
  return n > 0 ? n / 100 : null;
}
