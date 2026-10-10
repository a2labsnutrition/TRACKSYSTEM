import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Valida as migrations num Postgres embarcado (PGlite), com um stub mínimo
 * do schema `auth` e das roles do Supabase. Também testa o isolamento via RLS.
 */
const STUB = `
  create role authenticated nologin;
  create role anon nologin;
  create schema auth;
  create table auth.users (id uuid primary key);
  create or replace function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema auth to authenticated;
  grant execute on function auth.uid() to authenticated;
  -- Como no Supabase: privilégios padrão concedidos a anon/authenticated
  grant usage on schema public to anon, authenticated;
  alter default privileges in schema public grant all on tables to anon, authenticated;
  alter default privileges in schema public grant all on sequences to anon, authenticated;
`;

async function setup() {
  const db = new PGlite();
  await db.exec(STUB);
  const dir = join(process.cwd(), "supabase/migrations");
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
  return db;
}

describe("migrations SQL", () => {
  it("aplicam sem erro e criam as tabelas do escopo", async () => {
    const db = await setup();
    const res = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema='public'",
    );
    const names = res.rows.map((r) => r.table_name);
    for (const t of [
      "workspaces", "users", "ad_accounts", "pixels", "products", "offers", "campaigns", "adsets", "ads", "creatives",
      "insights_daily", "insights_breakdowns_daily", "tracking_sessions", "tracking_events", "capi_logs",
      "cakto_events_raw", "orders", "attribution_links", "alerts", "decision_rules", "advisor_reports", "user_notes",
      "niches", "subniches", "ad_references", "swipe_collections", "campaign_kits", "creative_assets", "flow_queue",
      "pdf_projects", "pdf_versions", "integration_credentials", "sync_jobs", "entity_events", "fx_rates",
    ]) expect(names).toContain(t);
  });

  it("RLS isola workspaces entre usuários", async () => {
    const db = await setup();
    const u1 = "00000000-0000-0000-0000-000000000001";
    const u2 = "00000000-0000-0000-0000-000000000002";
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${u1}';`);
    const ws1 = (await db.query<{ id: string }>("select public.create_workspace('WS1') as id")).rows[0].id;
    await db.query("insert into public.products (workspace_id, name, price) values ($1, 'Curso A', 97)", [ws1]);
    await db.exec(`set request.jwt.claim.sub = '${u2}';`);
    const seen = await db.query("select * from public.products");
    expect(seen.rows.length).toBe(0);
    await expect(
      db.query("insert into public.products (workspace_id, name, price) values ($1, 'Invasor', 1)", [ws1]),
    ).rejects.toThrow();
    await db.exec(`set request.jwt.claim.sub = '${u1}';`);
    const mine = await db.query("select * from public.products");
    expect(mine.rows.length).toBe(1);
  });

  it("navegador não consegue ler o segredo criptografado", async () => {
    const db = await setup();
    const u1 = "00000000-0000-0000-0000-000000000001";
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${u1}';`);
    const ws = (await db.query<{ id: string }>("select public.create_workspace('WS') as id")).rows[0].id;
    await db.exec("reset role;");
    await db.query("insert into public.integration_credentials (workspace_id, provider, label, encrypted_secret) values ($1, 'meta', 'default', 'v1:x:y:z')", [ws]);
    await db.exec(`set role authenticated; set request.jwt.claim.sub = '${u1}';`);
    const ok = await db.query("select provider, expires_at from public.integration_credentials");
    expect(ok.rows.length).toBe(1);
    await expect(db.query("select encrypted_secret from public.integration_credentials")).rejects.toThrow(/permission denied/);
    await expect(db.query("select * from public.integration_credentials")).rejects.toThrow(/permission denied/);
  });
});
