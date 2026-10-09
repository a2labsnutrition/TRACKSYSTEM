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
`;

async function setup() {
  const db = new PGlite();
  await db.exec(STUB);
  const dir = join(process.cwd(), "supabase/migrations");
  for (const f of readdirSync(dir).sort()) await db.exec(readFileSync(join(dir, f), "utf8"));
  await db.exec(`grant usage on schema public to authenticated;
    grant select, insert, update, delete on all tables in schema public to authenticated;
    revoke select (encrypted_secret) on public.integration_credentials from authenticated;`);
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
      "pdf_projects", "pdf_versions", "integration_credentials", "sync_jobs",
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
});
