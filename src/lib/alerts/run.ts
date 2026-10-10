import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { anomalyChecks, campaignRows } from "@/lib/analytics";
import type { Repository } from "@/lib/data/repository";
import { adminRepository } from "@/lib/data/supabase/context";
import { env } from "@/lib/env";
import { hourIn, resolvePeriod } from "@/lib/tz";
import { computeAlerts, severityRank, type AlertCandidate, type AlertInput } from "./engine";
import { notifyAlerts } from "./notify";

/** Monta a entrada do motor de alertas a partir do repositório. */
export async function alertInput(repo: Repository): Promise<AlertInput> {
  const ctx = await repo.context();
  const period = resolvePeriod(ctx.workspace.timezone, "7d");
  const health = await repo.health();
  const [rows, ads, anomalies] = await Promise.all([campaignRows(repo, period, health), repo.ads(), anomalyChecks(repo, health)]);
  const tz = ctx.adAccounts[0]?.timezone ?? ctx.workspace.timezone;
  const now = new Date();
  return {
    campaigns: rows.map((r) => ({
      id: r.campaign.id,
      name: r.campaign.name,
      active: r.campaign.effectiveStatus === "ACTIVE",
      dailyBudget: r.campaign.dailyBudget,
      spendToday: r.w1.spend,
      spend3d: r.w3.spend,
      signals: r.decision.signals,
    })),
    ads: ads.map((a) => ({ id: a.id, name: a.name, campaignId: a.campaignId, effectiveStatus: a.effectiveStatus })),
    accounts: ctx.adAccounts.map((a) => ({ id: a.id, name: a.name, status: a.status })),
    health,
    dayElapsed: (hourIn(now, tz) * 60 + now.getUTCMinutes()) / 1440,
    anomalies,
  };
}

export async function currentAlerts(repo: Repository): Promise<AlertCandidate[]> {
  return computeAlerts(await alertInput(repo));
}

export interface PersistResult {
  opened: AlertCandidate[];
  resolved: number;
  notified: number;
}

/**
 * Grava os alertas: abre novos, reabre os que voltaram, resolve os que sumiram
 * e notifica só o que é novo (não repete a cada hora).
 */
export async function persistAlerts(db: SupabaseClient, workspaceId: string, candidates: AlertCandidate[]): Promise<{ opened: AlertCandidate[]; resolved: number }> {
  const { data: existing } = await db.from("alerts").select("id, dedupe_key, status").eq("workspace_id", workspaceId);
  const byKey = new Map((existing ?? []).map((r) => [r.dedupe_key as string, r]));
  const opened: AlertCandidate[] = [];
  const now = new Date().toISOString();
  for (const c of candidates) {
    const row = byKey.get(c.dedupeKey);
    const fields = { type: c.type, severity: c.severity, entity_level: c.entityLevel, entity_id: c.entityId, message: `${c.title} — ${c.message}`, data: { href: c.href, title: c.title } };
    if (!row) {
      const { error } = await db.from("alerts").insert({ workspace_id: workspaceId, dedupe_key: c.dedupeKey, status: "open", ...fields });
      if (!error) opened.push(c);
    } else if (row.status !== "open") {
      await db.from("alerts").update({ ...fields, status: "open", created_at: now, resolved_at: null, notified_at: null }).eq("id", row.id);
      opened.push(c);
    } else {
      await db.from("alerts").update(fields).eq("id", row.id);
    }
  }
  const active = new Set(candidates.map((c) => c.dedupeKey));
  const toResolve = (existing ?? []).filter((r) => r.status === "open" && r.dedupe_key && !active.has(r.dedupe_key)).map((r) => r.id);
  if (toResolve.length) await db.from("alerts").update({ status: "resolved", resolved_at: now }).in("id", toResolve);
  return { opened, resolved: toResolve.length };
}

export async function runAlertsForWorkspace(db: SupabaseClient, workspaceId: string): Promise<PersistResult> {
  const repo = await adminRepository(db, workspaceId);
  if (!repo) return { opened: [], resolved: 0, notified: 0 };
  const ctx = await repo.context();
  const candidates = await currentAlerts(repo);
  const { opened, resolved } = await persistAlerts(db, workspaceId, candidates);
  const min = severityRank(ctx.workspace.notify.minSeverity);
  const toNotify = opened.filter((a) => severityRank(a.severity) >= min);
  let notified = 0;
  if (toNotify.length) {
    const results = await notifyAlerts(ctx.workspace.notify, toNotify, env.appUrl, ctx.workspace.name);
    if (results.some((r) => r.ok)) {
      notified = toNotify.length;
      await db
        .from("alerts")
        .update({ notified_at: new Date().toISOString() })
        .eq("workspace_id", workspaceId)
        .in("dedupe_key", toNotify.map((a) => a.dedupeKey));
    }
  }
  return { opened, resolved, notified };
}
