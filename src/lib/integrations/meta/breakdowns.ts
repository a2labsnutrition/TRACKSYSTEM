import type { BreakdownKey } from "@/lib/data/types";
import { toNumber } from "@/lib/utils";
import { actionValue } from "./insights";

/**
 * Detalhamentos (breakdowns) dos insights no nível de campanha.
 * age+gender vem numa chamada só; idade e gênero isolados são somas dela.
 * Nem todo breakdown aceita todos os campos (ex.: alcance por hora) — cada
 * chamada pede só o que é compatível e falhas são isoladas por breakdown.
 */

export interface BreakdownSpec {
  key: BreakdownKey;
  breakdowns: string;
  fields: string;
}

const BASE = "date_start,campaign_id,spend,impressions,inline_link_clicks,actions,action_values";

export const BREAKDOWN_SPECS: BreakdownSpec[] = [
  { key: "age_gender", breakdowns: "age,gender", fields: `${BASE},reach` },
  { key: "placement", breakdowns: "publisher_platform,platform_position", fields: `${BASE},reach` },
  { key: "device", breakdowns: "device_platform", fields: `${BASE},reach` },
  { key: "region", breakdowns: "region", fields: `${BASE},reach` },
  { key: "hour", breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone", fields: BASE },
];

type Raw = Record<string, unknown> & { actions?: Array<{ action_type?: string; value?: string }>; action_values?: Array<{ action_type?: string; value?: string }> };

export function breakdownValue(key: BreakdownKey, r: Raw): string {
  const s = (k: string) => String(r[k] ?? "?");
  switch (key) {
    case "age_gender":
      return `${s("age")}|${s("gender")}`;
    case "placement":
      return `${s("publisher_platform")}|${s("platform_position")}`;
    case "device":
      return s("device_platform");
    case "region":
      return s("region");
    case "hour":
      // "13:00:00 - 13:59:59" -> "13"
      return s("hourly_stats_aggregated_by_advertiser_time_zone").slice(0, 2);
    default:
      return "?";
  }
}

const LPV = ["landing_page_view", "omni_landing_page_view"];
const IC = ["offsite_conversion.fb_pixel_initiate_checkout", "omni_initiated_checkout", "initiate_checkout"];
const PURCHASE = ["offsite_conversion.fb_pixel_purchase", "omni_purchase", "purchase"];

export function parseBreakdownRow(key: BreakdownKey, r: Raw) {
  return {
    breakdown: key,
    value: breakdownValue(key, r),
    entityId: String(r.campaign_id ?? ""),
    date: String(r.date_start),
    spend: toNumber(r.spend),
    impressions: toNumber(r.impressions),
    reach: toNumber(r.reach),
    linkClicks: toNumber(r.inline_link_clicks),
    landingPageViews: actionValue(r.actions, LPV),
    initiateCheckout: actionValue(r.actions, IC),
    purchases: actionValue(r.actions, PURCHASE),
    purchaseValue: actionValue(r.action_values, PURCHASE),
  };
}

// ------------------------- Rótulos em português -------------------------

const GENDER: Record<string, string> = { female: "Mulheres", male: "Homens", unknown: "Não informado" };
const PLATFORM: Record<string, string> = { facebook: "Facebook", instagram: "Instagram", audience_network: "Audience Network", messenger: "Messenger", threads: "Threads" };
const POSITION: Record<string, string> = {
  feed: "Feed",
  story: "Stories",
  instagram_stories: "Stories",
  facebook_stories: "Stories",
  instagram_reels: "Reels",
  facebook_reels: "Reels",
  reels: "Reels",
  facebook_reels_overlay: "Reels (sobreposição)",
  instagram_explore: "Explorar",
  instagram_explore_grid_home: "Explorar (grade)",
  video_feeds: "Feed de vídeos",
  instream_video: "Vídeo in-stream",
  marketplace: "Marketplace",
  search: "Busca",
  right_hand_column: "Coluna direita",
  an_classic: "Nativo/banner",
  rewarded_video: "Vídeo com recompensa",
  instagram_profile_feed: "Feed do perfil",
  threads_feed: "Feed",
};
const DEVICE: Record<string, string> = { mobile_app: "Celular (app)", mobile_web: "Celular (web)", desktop: "Computador" };

export function breakdownLabel(key: BreakdownKey | "age" | "gender" | "weekday", value: string): string {
  switch (key) {
    case "gender":
      return GENDER[value] ?? value;
    case "age":
      return value === "Unknown" ? "Não informado" : value;
    case "age_gender": {
      const [a, g] = value.split("|");
      return `${GENDER[g] ?? g} ${a}`;
    }
    case "placement": {
      const [p, pos] = value.split("|");
      return `${PLATFORM[p] ?? p} · ${POSITION[pos] ?? pos.replace(/_/g, " ")}`;
    }
    case "device":
      return DEVICE[value] ?? value;
    case "hour":
      return `${value}h`;
    case "weekday":
      return ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][Number(value)] ?? value;
    default:
      return value;
  }
}

// ------------------------- Atividades da conta -------------------------

export interface RawActivity {
  event_type?: string;
  event_time?: string;
  object_id?: string;
  object_name?: string;
  object_type?: string;
  translated_event_type?: string;
  extra_data?: string;
}

const ACTIVITY_LABEL: Record<string, string> = {
  update_campaign_budget: "Orçamento da campanha alterado",
  update_ad_set_budget: "Orçamento do conjunto alterado",
  update_campaign_run_status: "Status da campanha alterado",
  update_ad_set_run_status: "Status do conjunto alterado",
  update_ad_run_status: "Status do anúncio alterado",
  create_campaign_group: "Campanha criada",
  create_campaign_legacy: "Campanha criada",
  create_ad_set: "Conjunto criado",
  create_ad: "Anúncio criado",
  update_ad_creative: "Criativo editado",
  update_ad_set_target_spec: "Público editado",
  update_ad_set_bid_strategy: "Estratégia de lance alterada",
  update_ad_set_bidding: "Lance alterado",
  update_ad_set_optimization_goal: "Meta de otimização alterada",
  update_campaign_budget_optimization: "CBO alterado",
};

/** Tipos que importam para a linha do tempo (o resto é ruído administrativo). */
export function isRelevantActivity(eventType: string): boolean {
  return eventType in ACTIVITY_LABEL || /budget|run_status|creative|target|bid/.test(eventType);
}

export function activityLabel(a: RawActivity): string {
  const base = ACTIVITY_LABEL[a.event_type ?? ""] ?? a.translated_event_type ?? a.event_type ?? "Alteração";
  let detail = "";
  if (a.extra_data) {
    try {
      const x = JSON.parse(a.extra_data) as { old_value?: unknown; new_value?: unknown; currency?: string };
      const fmt = (v: unknown) => {
        if (v && typeof v === "object" && "new_value" in (v as object)) return String((v as { new_value: unknown }).new_value);
        return typeof v === "number" ? (/budget/.test(a.event_type ?? "") ? `R$ ${(v / 100).toFixed(2).replace(".", ",")}` : String(v)) : String(v);
      };
      if (x.old_value !== undefined && x.new_value !== undefined) detail = `: ${fmt(x.old_value)} → ${fmt(x.new_value)}`;
    } catch {
      /* extra_data não-JSON */
    }
  }
  return `${base}${detail}${a.object_name ? ` (${a.object_name})` : ""}`;
}
