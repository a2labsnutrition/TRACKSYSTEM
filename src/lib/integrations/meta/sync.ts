import { redactText } from "@/lib/log";
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, sha256 } from "@/lib/crypto";
import { env } from "@/lib/env";
import type { Level } from "@/lib/data/types";
import { addDays, diffDays, todayIn } from "@/lib/tz";
import { graphGetAll, MetaApiError, type GraphOptions } from "./client";
import { activityLabel, BREAKDOWN_SPECS, isRelevantActivity, parseBreakdownRow, type RawActivity } from "./breakdowns";
import { budgetFromMeta, fieldsForLevel, parseInsight, type RawInsight } from "./insights";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Sincronização Meta → Supabase.
 *  - hourly: estrutura (campanhas/conjuntos/anúncios/criativos) + insights de ontem e hoje
 *  - daily: reprocessa os últimos 7 dias (o Meta ajusta números retroativamente)
 *  - backfill: na primeira conexão, histórico em blocos de 30 dias via fila (sync_jobs)
 * Snapshots diários são upsert por (workspace, nível, entidade, data): nada é apagado.
 */

export interface AccountRow {
  id: string;
  workspace_id: string;
  meta_account_id: string;
  timezone: string;
  credential_id: string | null;
  backfill_done: boolean;
}

export interface SyncLog {
  step: string;
  ok: boolean;
  count?: number;
  error?: string;
  at: string;
}

async function tokenFor(db: SupabaseClient, account: AccountRow): Promise<string> {
  let q = db.from("integration_credentials").select("encrypted_secret").eq("workspace_id", account.workspace_id);
  q = account.credential_id ? q.eq("id", account.credential_id) : q.eq("provider", "meta");
  const { data } = await q.limit(1);
  if (!data?.[0]) throw new Error("Sem token do Meta para esta conta. Conecte em Conexões → Meta.");
  return decryptSecret(data[0].encrypted_secret);
}

function targetingSummary(t: any): string | null {
  if (!t) return null;
  const parts: string[] = [];
  if (t.age_min || t.age_max) parts.push(`${t.age_min ?? 18}–${t.age_max ?? 65}+`);
  if (Array.isArray(t.genders) && t.genders.length === 1) parts.push(t.genders[0] === 1 ? "Homens" : "Mulheres");
  const countries = t.geo_locations?.countries;
  if (countries?.length) parts.push(countries.join(", "));
  const regions = t.geo_locations?.regions;
  if (regions?.length) parts.push(`${regions.length} região(ões)`);
  const interests = (t.flexible_spec ?? []).reduce((n: number, f: any) => n + (f.interests?.length ?? 0) + (f.behaviors?.length ?? 0), 0);
  parts.push(interests ? `${interests} interesse(s)` : "Amplo");
  if (t.custom_audiences?.length) parts.push(`${t.custom_audiences.length} público(s) personalizado(s)`);
  if (t.excluded_custom_audiences?.length) parts.push(`exclui ${t.excluded_custom_audiences.length}`);
  if (t.targeting_automation?.advantage_audience === 1) parts.push("Advantage+");
  return parts.join(" · ");
}

function creativeFormat(c: any): string {
  if (!c) return "unknown";
  if (c.video_id || c.object_story_spec?.video_data) return "video";
  if (c.object_story_spec?.link_data?.child_attachments?.length) return "carousel";
  if (c.image_url || c.object_story_spec?.link_data?.image_hash || c.thumbnail_url) return "image";
  return "unknown";
}

export async function syncStructure(db: SupabaseClient, account: AccountRow, opts: GraphOptions): Promise<SyncLog[]> {
  const log: SyncLog[] = [];
  const ws = account.workspace_id;
  const now = new Date().toISOString();

  const campaigns = await graphGetAll<any>(
    `${account.meta_account_id}/campaigns`,
    {
      fields: "id,name,status,effective_status,objective,daily_budget,lifetime_budget,bid_strategy,created_time,buying_type",
      limit: 200,
    },
    opts,
  );
  if (campaigns.length) {
    const { error } = await db.from("campaigns").upsert(
      campaigns.map((c) => ({
        workspace_id: ws,
        id: c.id,
        ad_account_id: account.id,
        name: c.name,
        status: c.status,
        effective_status: c.effective_status,
        objective: c.objective ?? null,
        daily_budget: budgetFromMeta(c.daily_budget),
        lifetime_budget: budgetFromMeta(c.lifetime_budget),
        budget_type: c.daily_budget || c.lifetime_budget ? "CBO" : "ABO",
        bid_strategy: c.bid_strategy ?? null,
        created_time: c.created_time ?? null,
        raw: c,
        updated_at: now,
      })),
      { onConflict: "workspace_id,id", ignoreDuplicates: false },
    );
    if (error) throw new Error(`campanhas: ${error.message}`);
  }
  log.push({ step: "campanhas", ok: true, count: campaigns.length, at: now });

  const adsets = await graphGetAll<any>(
    `${account.meta_account_id}/adsets`,
    {
      fields:
        "id,name,campaign_id,status,effective_status,optimization_goal,daily_budget,lifetime_budget,bid_strategy,targeting,created_time,learning_stage_info",
      limit: 200,
    },
    opts,
  );
  if (adsets.length) {
    // Detecta mudanças na fase de aprendizado (vira marcador na linha do tempo)
    const { data: prev } = await db.from("adsets").select("id, learning_stage, campaign_id").eq("workspace_id", ws);
    const prevStage = new Map((prev ?? []).map((p: any) => [p.id, p.learning_stage]));
    const learningEvents = adsets
      .filter((a) => {
        const before = prevStage.get(a.id);
        const after = a.learning_stage_info?.status ?? null;
        return before && after && before !== after;
      })
      .map((a) => {
        const after = a.learning_stage_info.status as string;
        const label =
          after === "SUCCESS"
            ? `Saiu da fase de aprendizado (${a.name})`
            : after === "FAIL"
              ? `Aprendizado limitado (${a.name})`
              : after === "LEARNING"
                ? `Voltou para a fase de aprendizado (${a.name})`
                : `Fase de aprendizado: ${after} (${a.name})`;
        return {
          workspace_id: ws,
          id: sha256(`learning|${a.id}|${after}|${now.slice(0, 10)}`),
          campaign_id: a.campaign_id,
          adset_id: a.id,
          event_type: `learning_${String(after).toLowerCase()}`,
          label,
          source: "sync_detected",
          event_time: now,
        };
      });
    if (learningEvents.length) await db.from("entity_events").upsert(learningEvents, { onConflict: "workspace_id,id", ignoreDuplicates: true });

    const { error } = await db.from("adsets").upsert(
      adsets.map((a) => ({
        workspace_id: ws,
        id: a.id,
        campaign_id: a.campaign_id,
        name: a.name,
        status: a.status,
        effective_status: a.effective_status,
        optimization_goal: a.optimization_goal ?? null,
        daily_budget: budgetFromMeta(a.daily_budget),
        lifetime_budget: budgetFromMeta(a.lifetime_budget),
        bid_strategy: a.bid_strategy ?? null,
        learning_stage: a.learning_stage_info?.status ?? null,
        targeting: a.targeting ?? null,
        targeting_summary: targetingSummary(a.targeting),
        created_time: a.created_time ?? null,
        raw: { ...a, targeting: undefined },
        updated_at: now,
      })),
    );
    if (error) throw new Error(`conjuntos: ${error.message}`);
  }
  log.push({ step: "conjuntos", ok: true, count: adsets.length, at: now });

  const ads = await graphGetAll<any>(
    `${account.meta_account_id}/ads`,
    {
      fields:
        "id,name,adset_id,campaign_id,status,effective_status,created_time,creative{id,name,title,body,thumbnail_url,image_url,video_id,call_to_action_type,object_story_spec,link_url}",
      thumbnail_width: 320,
      thumbnail_height: 320,
      limit: 200,
    },
    opts,
  );
  const creatives = ads.filter((a) => a.creative?.id).map((a) => a.creative);
  if (creatives.length) {
    const uniq = new Map(creatives.map((c: any) => [c.id, c]));
    const { error } = await db.from("creatives").upsert(
      [...uniq.values()].map((c: any) => {
        const link = c.object_story_spec?.link_data ?? c.object_story_spec?.video_data ?? {};
        return {
          workspace_id: ws,
          id: c.id,
          title: c.title ?? link.name ?? link.title ?? null,
          body: c.body ?? link.message ?? null,
          call_to_action: c.call_to_action_type ?? link.call_to_action?.type ?? null,
          thumbnail_url: c.thumbnail_url ?? null,
          image_url: c.image_url ?? link.picture ?? null,
          video_id: c.video_id ?? link.video_id ?? null,
          link_url: c.link_url ?? link.link ?? link.call_to_action?.value?.link ?? null,
          format: creativeFormat(c),
          raw: c,
          updated_at: now,
        };
      }),
    );
    if (error) throw new Error(`criativos: ${error.message}`);
  }
  if (ads.length) {
    const { error } = await db.from("ads").upsert(
      ads.map((a) => ({
        workspace_id: ws,
        id: a.id,
        adset_id: a.adset_id,
        campaign_id: a.campaign_id,
        creative_id: a.creative?.id ?? null,
        name: a.name,
        status: a.status,
        effective_status: a.effective_status,
        created_time: a.created_time ?? null,
        raw: { ...a, creative: a.creative ? { id: a.creative.id } : null },
        updated_at: now,
      })),
    );
    if (error) throw new Error(`anúncios: ${error.message}`);
  }
  log.push({ step: "anúncios", ok: true, count: ads.length, at: now });
  return log;
}

const LEVELS: Level[] = ["account", "campaign", "adset", "ad"];

export async function syncInsights(
  db: SupabaseClient,
  account: AccountRow,
  opts: GraphOptions,
  from: string,
  to: string,
): Promise<SyncLog[]> {
  const log: SyncLog[] = [];
  for (const level of LEVELS) {
    const at = new Date().toISOString();
    try {
      const raws = await graphGetAll<RawInsight>(
        `${account.meta_account_id}/insights`,
        {
          level,
          time_increment: 1,
          time_range: JSON.stringify({ since: from, until: to }),
          fields: fieldsForLevel(level),
          use_account_attribution_setting: "true",
          limit: 500,
        },
        opts,
        200,
      );
      const rows = raws.map((r) => {
        const p = parseInsight(r, level);
        return {
          workspace_id: account.workspace_id,
          ad_account_id: account.id,
          level,
          entity_id: level === "account" ? account.meta_account_id : p.entityId,
          campaign_id: p.campaignId,
          adset_id: p.adsetId,
          date: p.date,
          spend: p.spend,
          impressions: p.impressions,
          reach: p.reach,
          clicks: p.clicks,
          link_clicks: p.linkClicks,
          landing_page_views: p.landingPageViews,
          initiate_checkout: p.initiateCheckout,
          add_payment_info: p.addPaymentInfo,
          purchases: p.purchases,
          purchase_value: p.purchaseValue,
          video_3s: p.video3s,
          thruplay: p.thruplay,
          video_p25: p.videoP25,
          video_p50: p.videoP50,
          video_p75: p.videoP75,
          video_p95: p.videoP95,
          video_p100: p.videoP100,
          video_avg_time_sec: p.videoAvgTimeSec,
          quality_ranking: p.qualityRanking,
          engagement_ranking: p.engagementRanking,
          conversion_ranking: p.conversionRanking,
          raw: r,
          synced_at: at,
        };
      });
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db.from("insights_daily").upsert(rows.slice(i, i + 500), {
          onConflict: "workspace_id,level,entity_id,date",
        });
        if (error) throw new Error(error.message);
      }
      log.push({ step: `insights ${level} ${from}..${to}`, ok: true, count: rows.length, at });
    } catch (e) {
      // Falha parcial: registra e segue para o próximo nível.
      if (e instanceof MetaApiError && (e.isRateLimit || e.isTokenInvalid)) throw e;
      log.push({ step: `insights ${level} ${from}..${to}`, ok: false, error: (e as Error).message, at });
    }
  }
  return log;
}

/** Breakdowns por campanha (idade+gênero, posicionamento, dispositivo, região, horário). */
export async function syncBreakdowns(
  db: SupabaseClient,
  account: AccountRow,
  opts: GraphOptions,
  from: string,
  to: string,
): Promise<SyncLog[]> {
  const log: SyncLog[] = [];
  for (const spec of BREAKDOWN_SPECS) {
    const at = new Date().toISOString();
    try {
      const raws = await graphGetAll<Record<string, unknown>>(
        `${account.meta_account_id}/insights`,
        {
          level: "campaign",
          time_increment: 1,
          time_range: JSON.stringify({ since: from, until: to }),
          breakdowns: spec.breakdowns,
          fields: spec.fields,
          use_account_attribution_setting: "true",
          limit: 500,
        },
        opts,
        200,
      );
      const rows = raws.map((r) => {
        const p = parseBreakdownRow(spec.key, r);
        return {
          workspace_id: account.workspace_id,
          level: "campaign",
          entity_id: p.entityId,
          date: p.date,
          breakdown: p.breakdown,
          breakdown_value: p.value,
          spend: p.spend,
          impressions: p.impressions,
          reach: p.reach,
          link_clicks: p.linkClicks,
          landing_page_views: p.landingPageViews,
          initiate_checkout: p.initiateCheckout,
          purchases: p.purchases,
          purchase_value: p.purchaseValue,
          raw: r,
          synced_at: at,
        };
      });
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await db
          .from("insights_breakdowns_daily")
          .upsert(rows.slice(i, i + 500), { onConflict: "workspace_id,level,entity_id,date,breakdown,breakdown_value" });
        if (error) throw new Error(error.message);
      }
      log.push({ step: `breakdown ${spec.key}`, ok: true, count: rows.length, at });
    } catch (e) {
      if (e instanceof MetaApiError && (e.isRateLimit || e.isTokenInvalid)) throw e;
      // Falha parcial: o resto do painel continua funcionando
      log.push({ step: `breakdown ${spec.key}`, ok: false, error: e instanceof MetaApiError ? e.friendly : (e as Error).message, at });
    }
  }
  return log;
}

/** Atividades da conta (mudanças de orçamento, status, criativo, público) -> marcadores da linha do tempo. */
export async function syncActivities(db: SupabaseClient, account: AccountRow, opts: GraphOptions, sinceDays = 3): Promise<SyncLog[]> {
  const at = new Date().toISOString();
  try {
    const since = Math.floor((Date.now() - sinceDays * 86400_000) / 1000);
    const acts = await graphGetAll<RawActivity>(
      `${account.meta_account_id}/activities`,
      { fields: "event_type,event_time,object_id,object_name,object_type,translated_event_type,extra_data", since, limit: 500 },
      opts,
      10,
    );
    const relevant = acts.filter((a) => a.event_type && a.event_time && isRelevantActivity(a.event_type));
    if (!relevant.length) return [{ step: "atividades", ok: true, count: 0, at }];
    const ids = [...new Set(relevant.map((a) => a.object_id).filter(Boolean))] as string[];
    const [{ data: adsets }, { data: ads }] = await Promise.all([
      db.from("adsets").select("id, campaign_id").eq("workspace_id", account.workspace_id).in("id", ids),
      db.from("ads").select("id, adset_id, campaign_id").eq("workspace_id", account.workspace_id).in("id", ids),
    ]);
    const adsetMap = new Map((adsets ?? []).map((a: any) => [a.id, a]));
    const adMap = new Map((ads ?? []).map((a: any) => [a.id, a]));
    const rows = relevant.map((a) => {
      const type = (a.object_type ?? "").toUpperCase();
      const ad = adMap.get(a.object_id);
      const adset = adsetMap.get(a.object_id);
      const campaignId = type === "CAMPAIGN" ? a.object_id : ad?.campaign_id ?? adset?.campaign_id ?? null;
      return {
        workspace_id: account.workspace_id,
        id: sha256(`act|${a.object_id}|${a.event_type}|${a.event_time}`),
        campaign_id: campaignId,
        adset_id: type === "AD_SET" || type === "ADSET" ? a.object_id : ad?.adset_id ?? null,
        ad_id: type === "AD" ? a.object_id : null,
        event_type: a.event_type,
        label: activityLabel(a),
        source: "meta_activity",
        event_time: new Date(a.event_time!).toISOString(),
        extra: { object_type: a.object_type, extra_data: a.extra_data ?? null },
      };
    });
    const { error } = await db.from("entity_events").upsert(rows, { onConflict: "workspace_id,id", ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    return [{ step: "atividades", ok: true, count: rows.length, at }];
  } catch (e) {
    if (e instanceof MetaApiError && (e.isRateLimit || e.isTokenInvalid)) throw e;
    return [{ step: "atividades", ok: false, error: e instanceof MetaApiError ? e.friendly : (e as Error).message, at }];
  }
}

/** Divide [from, to] em blocos de até `size` dias. */
export function chunkRange(from: string, to: string, size = 30): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  let cur = from;
  while (cur <= to) {
    const end = addDays(cur, size - 1) < to ? addDays(cur, size - 1) : to;
    out.push({ from: cur, to: end });
    cur = addDays(end, 1);
  }
  return out;
}

/** Enfileira o histórico (backfill) de uma conta recém-conectada. */
export async function enqueueBackfill(db: SupabaseClient, account: AccountRow, days = env.metaHistoryDays) {
  const today = todayIn(account.timezone);
  const from = addDays(today, -Math.max(1, days));
  const chunks = chunkRange(from, addDays(today, -1), 30).reverse(); // mais recente primeiro
  if (!chunks.length) return 0;
  await db.from("sync_jobs").insert(
    chunks.map((c, i) => ({
      workspace_id: account.workspace_id,
      ad_account_id: account.id,
      kind: "meta_insights",
      range_from: c.from,
      range_to: c.to,
      next_run_at: new Date(Date.now() + i * 1000).toISOString(),
    })),
  );
  await db.from("ad_accounts").update({ backfill_done: true }).eq("id", account.id);
  return chunks.length;
}

export interface CycleResult {
  accounts: number;
  jobsProcessed: number;
  errors: string[];
  logs: SyncLog[];
}

/**
 * Um ciclo do cron. mode=hourly: estrutura + ontem/hoje; mode=daily: últimos 7 dias.
 * Depois processa jobs de backfill até o orçamento de tempo acabar.
 */
export async function runSyncCycle(
  db: SupabaseClient,
  mode: "hourly" | "daily",
  opts: { timeBudgetMs?: number; workspaceId?: string } = {},
): Promise<CycleResult> {
  const started = Date.now();
  const budget = opts.timeBudgetMs ?? 50_000;
  const result: CycleResult = { accounts: 0, jobsProcessed: 0, errors: [], logs: [] };

  let q = db.from("ad_accounts").select("id, workspace_id, meta_account_id, timezone, credential_id, backfill_done").eq("is_active", true);
  if (opts.workspaceId) q = q.eq("workspace_id", opts.workspaceId);
  const { data: accounts, error } = await q;
  if (error) throw new Error(error.message);

  for (const account of (accounts ?? []) as AccountRow[]) {
    result.accounts++;
    try {
      const token = await tokenFor(db, account);
      const gopts: GraphOptions = { accessToken: token };
      if (!account.backfill_done) await enqueueBackfill(db, account);
      const today = todayIn(account.timezone);
      // Estrutura em todo ciclo (o diário pode ser o único agendamento no plano Hobby da Vercel)
      result.logs.push(...(await syncStructure(db, account, gopts)));
      if (mode === "hourly") result.logs.push(...(await syncActivities(db, account, gopts, 2)));
      const from = mode === "daily" ? addDays(today, -7) : addDays(today, -1);
      result.logs.push(...(await syncInsights(db, account, gopts, from, today)));
      // Breakdowns: diário (14 dias) ou na primeira vez que a conta sincroniza
      const { count: bdCount } = await db
        .from("insights_breakdowns_daily")
        .select("entity_id", { count: "exact", head: true })
        .eq("workspace_id", account.workspace_id);
      if (mode === "daily" || !bdCount) {
        result.logs.push(...(await syncBreakdowns(db, account, gopts, addDays(today, -13), today)));
        if (mode === "daily") result.logs.push(...(await syncActivities(db, account, gopts, 8)));
      }
      await db.from("ad_accounts").update({ last_synced_at: new Date().toISOString() }).eq("id", account.id);
      await recordJob(db, account, mode, "done", result.logs.filter((l) => !l.ok).map((l) => l.error).join("; ") || null);
    } catch (e) {
      const msg = e instanceof MetaApiError ? e.friendly : (e as Error).message;
      result.errors.push(`${account.meta_account_id}: ${msg}`);
      await recordJob(db, account, mode, "failed", msg);
    }
    if (Date.now() - started > budget) return result;
  }

  // ---- fila de backfill ----
  while (Date.now() - started < budget) {
    const { data: jobs } = await db
      .from("sync_jobs")
      .select("*")
      .eq("status", "queued")
      .eq("kind", "meta_insights")
      .lte("next_run_at", new Date().toISOString())
      .order("next_run_at")
      .limit(1);
    const job = jobs?.[0];
    if (!job) break;
    await db.from("sync_jobs").update({ status: "running", started_at: new Date().toISOString(), attempts: job.attempts + 1 }).eq("id", job.id);
    const { data: acc } = await db
      .from("ad_accounts")
      .select("id, workspace_id, meta_account_id, timezone, credential_id, backfill_done")
      .eq("id", job.ad_account_id)
      .single();
    try {
      const token = await tokenFor(db, acc as AccountRow);
      const logs = await syncInsights(db, acc as AccountRow, { accessToken: token }, job.range_from, job.range_to);
      await db.from("sync_jobs").update({ status: "done", finished_at: new Date().toISOString(), log: logs }).eq("id", job.id);
      result.jobsProcessed++;
    } catch (e) {
      const err = e as Error;
      const retry = job.attempts + 1 < 5;
      const wait = e instanceof MetaApiError && e.isRateLimit ? 15 * 60_000 : 2 ** job.attempts * 60_000;
      await db
        .from("sync_jobs")
        .update({
          status: retry ? "queued" : "failed",
          last_error: redactText(e instanceof MetaApiError ? e.friendly : err.message),
          next_run_at: new Date(Date.now() + wait).toISOString(),
        })
        .eq("id", job.id);
      if (e instanceof MetaApiError && e.isRateLimit) break;
    }
  }
  return result;
}

async function recordJob(db: SupabaseClient, account: AccountRow, mode: string, status: "done" | "failed", error: string | null) {
  await db.from("sync_jobs").insert({
    workspace_id: account.workspace_id,
    ad_account_id: account.id,
    kind: `meta_${mode}`,
    status,
    attempts: 1,
    last_error: error,
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
  });
}

export function rangeDays(from: string, to: string) {
  return diffDays(from, to) + 1;
}
