"use server";

import { revalidatePath } from "next/cache";
import { readCredential, saveCredential, markCredentialError } from "@/lib/credentials";
import { requireLiveWorkspace } from "@/lib/data";
import { isMetaAppConfigured } from "@/lib/env";
import { randomId } from "@/lib/utils";
import { getIngestStore, DEMO_SITE_KEY } from "@/lib/ingest";
import { dispatchCapi } from "@/lib/ingest/capi-dispatch";
import { processCaktoWebhook, reprocessStoredCaktoEvent } from "@/lib/ingest/cakto-webhook";
import { caktoToken } from "@/lib/integrations/cakto/api";
import { reconcileCaktoWorkspace } from "@/lib/ingest/cakto-reconcile";
import { MetaApiError } from "@/lib/integrations/meta/client";
import { debugToken, listAdAccounts, ACCOUNT_STATUS } from "@/lib/integrations/meta/oauth";
import { enqueueBackfill, runSyncCycle, type AccountRow } from "@/lib/integrations/meta/sync";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { verifyInstallation, type VerifyResult } from "@/lib/tracking/verify";

export interface ActionState {
  ok: boolean;
  message: string;
  verify?: VerifyResult;
}

const fail = (e: unknown): ActionState => ({
  ok: false,
  message: e instanceof MetaApiError ? e.friendly : (e as Error).message,
});

function done(message: string): ActionState {
  revalidatePath("/conexoes");
  revalidatePath("/saude");
  return { ok: true, message };
}

// ============================== META ==============================

export async function saveMetaToken(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const token = String(form.get("token") ?? "").trim();
    if (token.length < 20) return { ok: false, message: "Cole o token de acesso completo." };
    const accounts = await listAdAccounts(token); // valida o token
    let expiresAt: string | null = null;
    let scopes: string[] = [];
    if (isMetaAppConfigured()) {
      try {
        const info = await debugToken(token);
        expiresAt = info.expiresAt;
        scopes = info.scopes;
      } catch {
        /* sem app configurado, segue sem data de expiração */
      }
    }
    await saveCredential(supabaseAdmin(), ctx.workspace.id, "meta", token, { expiresAt, meta: { scopes, source: "manual" } });
    return done(`Token salvo. ${accounts.length} conta(s) de anúncio encontradas — ative abaixo.`);
  } catch (e) {
    return fail(e);
  }
}

export async function activateAdAccounts(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const db = supabaseAdmin();
    const cred = await readCredential(db, ctx.workspace.id, "meta");
    if (!cred) return { ok: false, message: "Conecte o Meta primeiro." };
    const wanted = new Set(form.getAll("account").map(String));
    const all = await listAdAccounts(cred.secret);
    const rows = all.map((a) => ({
      workspace_id: ctx.workspace.id,
      meta_account_id: a.id,
      name: a.name,
      currency: a.currency,
      timezone: a.timezone_name,
      account_status: ACCOUNT_STATUS[a.account_status] ?? String(a.account_status),
      credential_id: cred.id,
      is_active: wanted.has(a.id),
    }));
    const { data, error } = await db.from("ad_accounts").upsert(rows, { onConflict: "workspace_id,meta_account_id" }).select("*");
    if (error) throw new Error(error.message);
    let queued = 0;
    for (const acc of (data ?? []) as Array<AccountRow & { is_active: boolean }>) {
      if (acc.is_active && !acc.backfill_done) queued += await enqueueBackfill(db, acc);
    }
    return done(`${wanted.size} conta(s) ativa(s). Histórico enfileirado em ${queued} bloco(s) — clique em “Sincronizar agora”.`);
  } catch (e) {
    return fail(e);
  }
}

export async function syncNow(): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const r = await runSyncCycle(supabaseAdmin(), "hourly", { workspaceId: ctx.workspace.id, timeBudgetMs: 45_000 });
    const failed = r.logs.filter((l) => !l.ok);
    if (r.errors.length) {
      await markCredentialError(supabaseAdmin(), ctx.workspace.id, "meta", r.errors.join("; "));
      return { ok: false, message: r.errors.join(" · ") };
    }
    await markCredentialError(supabaseAdmin(), ctx.workspace.id, "meta", null);
    revalidatePath("/", "layout");
    return {
      ok: true,
      message: `Sincronizado: ${r.accounts} conta(s), ${r.logs.filter((l) => l.ok).reduce((s, l) => s + (l.count ?? 0), 0)} registros, ${r.jobsProcessed} bloco(s) de histórico.${failed.length ? ` Falhas parciais: ${failed.map((f) => f.step).join(", ")}.` : ""}`,
    };
  } catch (e) {
    return fail(e);
  }
}

export async function savePixel(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const db = supabaseAdmin();
    const pixelId = String(form.get("pixelId") ?? "").replace(/\D/g, "");
    const capiToken = String(form.get("capiToken") ?? "").trim();
    const testCode = String(form.get("testEventCode") ?? "").trim() || null;
    if (pixelId.length < 6) return { ok: false, message: "Informe o ID numérico do Pixel (Gerenciador de Eventos)." };
    let capiCredId: string | null = null;
    if (capiToken) capiCredId = await saveCredential(db, ctx.workspace.id, "meta_capi", capiToken, { meta: { pixelId } });
    else capiCredId = (await readCredential(db, ctx.workspace.id, "meta_capi"))?.id ?? null;
    const { error } = await db.from("pixels").upsert(
      { workspace_id: ctx.workspace.id, pixel_id: pixelId, test_event_code: testCode, capi_credential_id: capiCredId },
      { onConflict: "workspace_id,pixel_id" },
    );
    if (error) throw new Error(error.message);
    // Sites sem Pixel passam a usar este
    await db.from("tracking_sites").update({ pixel_id: pixelId }).eq("workspace_id", ctx.workspace.id).is("pixel_id", null);
    return done(`Pixel ${pixelId} salvo${capiCredId ? " com token da CAPI" : " (CAPI usará o token do Meta conectado)"}.`);
  } catch (e) {
    return fail(e);
  }
}

export async function sendTestEvent(): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const store = getIngestStore();
    const cfg = await store.capiConfig(ctx.workspace.id);
    if (!cfg) return { ok: false, message: "Configure o Pixel e um token com acesso a ele primeiro." };
    if (!cfg.testEventCode) return { ok: false, message: "Informe o código de teste (Gerenciador de Eventos → Testar eventos) no campo do Pixel e salve." };
    const r = await dispatchCapi(
      store,
      ctx.workspace.id,
      { eventName: "PageView", eventId: `test_${randomId(8)}`, eventTime: new Date(), eventSourceUrl: "https://teste.central-de-comando.local/", clientIp: "200.200.200.200", userAgent: "CentralComando/teste" },
      "test",
    );
    if (r.status === "sent") return done(`Evento de teste enviado. Resposta do Meta: ${r.result?.response}. Confira em Testar eventos.`);
    return { ok: false, message: `Falhou: ${r.result?.response ?? r.reason}` };
  } catch (e) {
    return fail(e);
  }
}

// ============================== SCRIPT / SITES ==============================

export async function createSite(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const db = supabaseAdmin();
    const name = String(form.get("name") ?? "").trim() || "Minha página";
    const domain = String(form.get("domain") ?? "").trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "") || null;
    const { data: px } = await db.from("pixels").select("pixel_id").eq("workspace_id", ctx.workspace.id).limit(1);
    const { error } = await db.from("tracking_sites").insert({
      workspace_id: ctx.workspace.id,
      public_key: `s_${randomId(10)}`,
      name,
      domain,
      pixel_id: px?.[0]?.pixel_id ?? null,
    });
    if (error) throw new Error(error.message);
    return done("Site criado. Copie o snippet abaixo e cole no <head> da página.");
  } catch (e) {
    return fail(e);
  }
}

export async function updateSite(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const id = String(form.get("siteId"));
    const selectors = String(form.get("selectors") ?? "")
      .split(/[\n,]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 30);
    const idParam = String(form.get("idParam") ?? "sck").replace(/[^a-zA-Z0-9_]/g, "") || "sck";
    const consent = form.get("consentMode") === "required" ? "required" : "none";
    const pixelId = String(form.get("pixelId") ?? "").replace(/\D/g, "") || null;
    const { error } = await supabaseAdmin()
      .from("tracking_sites")
      .update({ checkout_selectors: selectors, id_param: idParam, consent_mode: consent, pixel_id: pixelId })
      .eq("id", id)
      .eq("workspace_id", ctx.workspace.id);
    if (error) throw new Error(error.message);
    return done("Configuração do script salva (vale em até 1 minuto na página).");
  } catch (e) {
    return fail(e);
  }
}

export async function verifySite(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const url = String(form.get("url") ?? "").trim();
    const siteKey = String(form.get("siteKey") ?? DEMO_SITE_KEY);
    const pixel = String(form.get("pixelId") ?? "") || null;
    if (!url) return { ok: false, message: "Informe a URL da página." };
    const verify = await verifyInstallation(url, siteKey, pixel);
    const errors = verify.checks.filter((c) => c.status === "error").length;
    return { ok: errors === 0, message: errors ? `${errors} problema(s) encontrado(s).` : "Instalação OK.", verify };
  } catch (e) {
    return fail(e);
  }
}

// ============================== CAKTO ==============================

export async function saveCaktoSecret(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const secret = String(form.get("secret") ?? "").trim();
    if (secret.length < 6) return { ok: false, message: "Cole o segredo (secret) do webhook gerado pela Cakto." };
    await saveCredential(supabaseAdmin(), ctx.workspace.id, "cakto", secret, { withLookupHash: true });
    return done("Segredo salvo. Agora clique em “Testar webhook” ou faça um pedido de teste na Cakto.");
  } catch (e) {
    return fail(e);
  }
}

export async function testCaktoWebhook(): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const cred = await readCredential(supabaseAdmin(), ctx.workspace.id, "cakto");
    if (!cred) return { ok: false, message: "Salve o segredo do webhook primeiro." };
    const r = await processCaktoWebhook(
      getIngestStore(),
      { secret: cred.secret, event: "test", data: { id: `teste_${randomId(6)}`, info: "Evento de teste da Central de Comando" } },
      { "x-test": "1" },
      { workspaceKey: ctx.workspace.id },
    );
    if (r.status !== 200) return { ok: false, message: String(r.body.error ?? `HTTP ${r.status}`) };
    return done("Webhook OK: o endpoint recebeu, validou o segredo e gravou o evento. Para testar ponta a ponta, use “Enviar teste” na Cakto.");
  } catch (e) {
    return fail(e);
  }
}

export async function saveCaktoApi(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const clientId = String(form.get("clientId") ?? "").trim();
    const clientSecret = String(form.get("clientSecret") ?? "").trim();
    if (!clientId || !clientSecret) return { ok: false, message: "Informe client_id e client_secret da API da Cakto." };
    await caktoToken({ clientId, clientSecret });
    await saveCredential(supabaseAdmin(), ctx.workspace.id, "cakto_api", JSON.stringify({ clientId, clientSecret }));
    return done("API da Cakto conectada. Use “Conciliar 7 dias” para buscar pedidos que o webhook possa ter perdido.");
  } catch (e) {
    return fail(e);
  }
}

async function reconcile(days: number): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const r = await reconcileCaktoWorkspace(supabaseAdmin(), getIngestStore(), ctx.workspace.id, ctx.workspace.timezone, { days });
    if (!r) return { ok: false, message: "Conecte a API da Cakto (opcional) para conciliar." };
    return done(
      `${r.read} pedido(s) lidos da API (${days} dias): ${r.created} novo(s)/atualizado(s), ${r.duplicates} já estavam registrados.` +
        (r.rest > 0 ? ` Faltaram ${r.rest} por tempo — clique de novo para continuar.` : ""),
    );
  } catch (e) {
    return fail(e);
  }
}

export async function reconcileCakto(): Promise<ActionState> {
  return reconcile(7);
}

export async function reconcileCakto30(): Promise<ActionState> {
  return reconcile(30);
}

export async function reprocessFailedCakto(): Promise<ActionState> {
  try {
    const { ctx } = await requireLiveWorkspace();
    const db = supabaseAdmin();
    const { data } = await db
      .from("cakto_events_raw")
      .select("id, payload")
      .eq("workspace_id", ctx.workspace.id)
      .eq("signature_valid", true)
      .eq("processed", false)
      .not("process_error", "is", null)
      .limit(200);
    let ok = 0;
    for (const r of data ?? []) {
      const res = await reprocessStoredCaktoEvent(getIngestStore(), ctx.workspace.id, String(r.id), r.payload);
      if (res.status === 200) ok++;
    }
    return done(`${ok} de ${data?.length ?? 0} evento(s) reprocessado(s).`);
  } catch (e) {
    return fail(e);
  }
}
