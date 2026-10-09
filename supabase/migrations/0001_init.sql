-- =====================================================================
-- Central de Comando de Meta Ads — schema inicial
-- Multi-workspace; todas as tabelas com workspace_id + RLS.
-- Escritas de servidor (webhooks, coleta, sync) usam a service role,
-- que ignora RLS. Leitura do painel usa o usuário autenticado.
-- =====================================================================

-- gen_random_uuid() é nativo no Postgres 13+ (Supabase usa 15+).

-- ---------------------------------------------------------------------
-- Workspaces e membros
-- ---------------------------------------------------------------------
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/Cuiaba',
  currency text not null default 'BRL',
  tax_rate numeric(6,4) not null default 0,
  default_fee_rate numeric(6,4) not null default 0.0699,
  created_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists public.users (
  id uuid primary key, -- = auth.users.id
  email text,
  full_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null,
  role text not null default 'owner' check (role in ('owner','admin','analyst','viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

-- Função usada pelas políticas (security definer evita recursão de RLS)
create or replace function public.is_workspace_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.workspace_members m
    where m.workspace_id = ws and m.user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------------
-- Credenciais (sempre criptografadas pela aplicação — AES-256-GCM)
-- ---------------------------------------------------------------------
create table if not exists public.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  provider text not null check (provider in ('meta','meta_capi','cakto','cakto_api','anthropic','ad_library','google_flow')),
  label text,
  encrypted_secret text not null,
  -- sha256 do segredo: permite achar o workspace pelo segredo do webhook da Cakto
  lookup_hash text,
  meta jsonb not null default '{}'::jsonb,
  expires_at timestamptz,
  status text not null default 'active',
  last_checked_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, provider, label)
);
create index if not exists integration_credentials_lookup_idx on public.integration_credentials (provider, lookup_hash);

-- ---------------------------------------------------------------------
-- Meta: contas, pixels, estrutura
-- ---------------------------------------------------------------------
create table if not exists public.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  meta_account_id text not null, -- act_123
  name text not null,
  currency text not null default 'BRL',
  timezone text not null default 'America/Sao_Paulo',
  account_status text,
  credential_id uuid references public.integration_credentials(id) on delete set null,
  is_active boolean not null default true,
  backfill_done boolean not null default false,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, meta_account_id)
);

create table if not exists public.pixels (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ad_account_id uuid references public.ad_accounts(id) on delete set null,
  pixel_id text not null,
  name text,
  capi_credential_id uuid references public.integration_credentials(id) on delete set null,
  test_event_code text,
  created_at timestamptz not null default now(),
  unique (workspace_id, pixel_id)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  price numeric(12,2) not null default 0,
  net_per_sale numeric(12,2),
  target_cpa numeric(12,2),
  max_cpa numeric(12,2),
  min_roas numeric(8,3),
  cakto_product_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  name text not null,
  price numeric(12,2),
  cakto_offer_id text,
  checkout_url text,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.campaigns (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null, -- id do Meta
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  name text not null,
  status text,
  effective_status text,
  objective text,
  daily_budget numeric(12,2),
  lifetime_budget numeric(12,2),
  budget_type text,
  bid_strategy text,
  created_time timestamptz,
  raw jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists public.adsets (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  campaign_id text not null,
  name text not null,
  status text,
  effective_status text,
  optimization_goal text,
  daily_budget numeric(12,2),
  lifetime_budget numeric(12,2),
  bid_strategy text,
  learning_stage text,
  targeting jsonb,
  targeting_summary text,
  created_time timestamptz,
  raw jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists public.creatives (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  title text,
  body text,
  call_to_action text,
  thumbnail_url text,
  image_url text,
  video_id text,
  link_url text,
  format text,
  raw jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

create table if not exists public.ads (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null,
  adset_id text not null,
  campaign_id text not null,
  creative_id text,
  name text not null,
  status text,
  effective_status text,
  created_time timestamptz,
  raw jsonb,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, id)
);

-- Snapshots diários — nunca apagados; reprocessados (últimos 7 dias) pelo sync.
create table if not exists public.insights_daily (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  level text not null check (level in ('account','campaign','adset','ad')),
  entity_id text not null,
  campaign_id text,
  adset_id text,
  date date not null,
  spend numeric(14,2) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  clicks bigint not null default 0,
  link_clicks bigint not null default 0,
  landing_page_views bigint not null default 0,
  initiate_checkout bigint not null default 0,
  add_payment_info bigint not null default 0,
  purchases numeric(12,2) not null default 0,
  purchase_value numeric(14,2) not null default 0,
  video_3s bigint not null default 0,
  thruplay bigint not null default 0,
  video_p25 bigint not null default 0,
  video_p50 bigint not null default 0,
  video_p75 bigint not null default 0,
  video_p95 bigint not null default 0,
  video_p100 bigint not null default 0,
  video_avg_time_sec numeric(10,2),
  quality_ranking text,
  engagement_ranking text,
  conversion_ranking text,
  raw jsonb,
  synced_at timestamptz not null default now(),
  primary key (workspace_id, level, entity_id, date)
);
create index if not exists insights_daily_date_idx on public.insights_daily (workspace_id, date);
create index if not exists insights_daily_campaign_idx on public.insights_daily (workspace_id, campaign_id, date);

create table if not exists public.insights_breakdowns_daily (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  level text not null,
  entity_id text not null,
  date date not null,
  breakdown text not null, -- age, gender, age_gender, publisher_platform, platform_position, device_platform, region, hourly
  breakdown_value text not null,
  spend numeric(14,2) not null default 0,
  impressions bigint not null default 0,
  reach bigint not null default 0,
  link_clicks bigint not null default 0,
  landing_page_views bigint not null default 0,
  initiate_checkout bigint not null default 0,
  purchases numeric(12,2) not null default 0,
  purchase_value numeric(14,2) not null default 0,
  raw jsonb,
  synced_at timestamptz not null default now(),
  primary key (workspace_id, level, entity_id, date, breakdown, breakdown_value)
);

-- ---------------------------------------------------------------------
-- Tracking first-party
-- ---------------------------------------------------------------------
create table if not exists public.tracking_sites (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  public_key text not null unique,
  name text not null,
  domain text,
  pixel_id text,
  checkout_selectors text[] not null default '{}',
  id_param text not null default 'sck',
  consent_mode text not null default 'none' check (consent_mode in ('none','required')),
  created_at timestamptz not null default now()
);

create table if not exists public.tracking_sessions (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null, -- session_id gerado no navegador
  site_id uuid not null references public.tracking_sites(id) on delete cascade,
  visitor_id text,
  first_url text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  fbclid text,
  fbp text,
  fbc text,
  client_ip text,
  user_agent text,
  device text,
  email_hash text,
  phone_hash text,
  campaign_id text,
  adset_id text,
  ad_id text,
  started_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index if not exists tracking_sessions_fbclid_idx on public.tracking_sessions (workspace_id, fbclid);
create index if not exists tracking_sessions_email_idx on public.tracking_sessions (workspace_id, email_hash);
create index if not exists tracking_sessions_phone_idx on public.tracking_sessions (workspace_id, phone_hash);
create index if not exists tracking_sessions_visitor_idx on public.tracking_sessions (workspace_id, visitor_id);

create table if not exists public.tracking_events (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  site_id uuid not null references public.tracking_sites(id) on delete cascade,
  event_name text not null,
  event_id text not null,
  session_id text,
  visitor_id text,
  url text,
  referrer text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  fbclid text,
  fbp text,
  fbc text,
  client_ip text,
  user_agent text,
  props jsonb not null default '{}'::jsonb,
  capi_status text,
  created_at timestamptz not null default now(),
  unique (site_id, event_id, event_name)
);
create index if not exists tracking_events_created_idx on public.tracking_events (workspace_id, created_at desc);
create index if not exists tracking_events_checkout_idx on public.tracking_events (workspace_id, event_name, created_at desc);

create table if not exists public.capi_logs (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  pixel_id text,
  event_name text not null,
  event_id text not null,
  source text not null default 'tracking',
  status text not null check (status in ('pending','sent','failed','skipped')),
  http_status int,
  match_keys int,
  request jsonb,
  response text,
  attempts int not null default 0,
  next_retry_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, event_name, event_id)
);

-- ---------------------------------------------------------------------
-- Cakto
-- ---------------------------------------------------------------------
create table if not exists public.cakto_events_raw (
  id bigint generated always as identity primary key,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  dedupe_key text not null,
  event_name text,
  order_external_id text,
  payload jsonb not null,
  headers jsonb,
  signature_valid boolean not null default false,
  processed boolean not null default false,
  process_error text,
  warnings text[] not null default '{}',
  received_at timestamptz not null default now(),
  unique (workspace_id, dedupe_key)
);

create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  external_id text not null,
  product_id uuid references public.products(id) on delete set null,
  product_external_id text,
  product_name text,
  offer_id text,
  status text not null,
  payment_method text not null default 'other',
  gross_amount numeric(12,2) not null default 0,
  fees numeric(12,2) not null default 0,
  net_amount numeric(12,2) not null default 0,
  net_estimated boolean not null default false,
  currency text not null default 'BRL',
  coupon text,
  is_order_bump boolean not null default false,
  is_upsell boolean not null default false,
  parent_order_id text,
  customer_name text,
  customer_email text,
  customer_phone text,
  email_hash text,
  phone_hash text,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  sck text,
  src text,
  fbclid text,
  fbp text,
  fbc text,
  session_id text,
  campaign_id text,
  adset_id text,
  ad_id text,
  attribution_method text not null default 'unattributed',
  attribution_confidence numeric(4,3) not null default 0,
  capi_purchase_sent_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  refunded_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (workspace_id, external_id)
);
create index if not exists orders_created_idx on public.orders (workspace_id, created_at desc);
create index if not exists orders_campaign_idx on public.orders (workspace_id, campaign_id);

create table if not exists public.attribution_links (
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  session_id text,
  method text not null,
  confidence numeric(4,3) not null,
  campaign_id text,
  adset_id text,
  ad_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Inteligência (Fase 2) — tabelas já criadas para manter o schema estável
-- ---------------------------------------------------------------------
create table if not exists public.decision_rules (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid references public.products(id) on delete cascade,
  campaign_id text,
  config jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.advisor_reports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id text not null,
  report_date date not null,
  status text not null,
  confidence text,
  signals jsonb not null default '[]'::jsonb,
  input_snapshot jsonb,
  content jsonb,
  model text,
  created_at timestamptz not null default now()
);

create table if not exists public.alerts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  type text not null,
  severity text not null,
  entity_level text,
  entity_id text,
  message text not null,
  data jsonb,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.user_notes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  campaign_id text,
  adset_id text,
  ad_id text,
  note_date date not null default current_date,
  kind text not null default 'note',
  text text not null,
  created_by uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Descobrir & Criar / Criativos / PDF (Fases 3–4)
-- ---------------------------------------------------------------------
create table if not exists public.niches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  slug text not null,
  name text not null,
  score jsonb,
  sensitive boolean not null default false,
  source text not null default 'ai_estimate',
  created_at timestamptz not null default now(),
  unique (workspace_id, slug)
);

create table if not exists public.subniches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  niche_id uuid not null references public.niches(id) on delete cascade,
  slug text not null,
  name text not null,
  score jsonb,
  source text not null default 'ai_estimate',
  created_at timestamptz not null default now()
);

create table if not exists public.ad_references (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  niche_id uuid references public.niches(id) on delete set null,
  source text not null, -- manual | provider:<nome> | ai_estimate
  source_url text,
  advertiser text,
  format text,
  first_seen date,
  days_running int,
  data jsonb not null default '{}'::jsonb,
  analysis jsonb,
  collected_at timestamptz not null default now()
);

create table if not exists public.swipe_collections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  items jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.campaign_kits (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  campaign_id text,
  kind text not null, -- offer | landing | vsl | scripts | structure | compliance
  version int not null default 1,
  content jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists public.creative_assets (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kit_id uuid references public.campaign_kits(id) on delete set null,
  storage_path text not null,
  ad_name text,
  angle text,
  hook text,
  meta_ad_id text,
  created_at timestamptz not null default now()
);

create table if not exists public.flow_queue (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  kit_id uuid references public.campaign_kits(id) on delete set null,
  prompt text not null,
  priority int not null default 0,
  scheduled_for date not null default current_date,
  status text not null default 'todo',
  asset_id uuid references public.creative_assets(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.pdf_projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  title text not null,
  brief text,
  theme jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.pdf_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  project_id uuid not null references public.pdf_projects(id) on delete cascade,
  version int not null,
  content jsonb not null,
  pdf_path text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Jobs de sincronização (fila com retry/backoff)
-- ---------------------------------------------------------------------
create table if not exists public.sync_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  ad_account_id uuid references public.ad_accounts(id) on delete cascade,
  kind text not null, -- meta_structure | meta_insights | cakto_orders
  range_from date,
  range_to date,
  status text not null default 'queued' check (status in ('queued','running','done','failed')),
  attempts int not null default 0,
  next_run_at timestamptz not null default now(),
  last_error text,
  log jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);
create index if not exists sync_jobs_queue_idx on public.sync_jobs (status, next_run_at);

-- ---------------------------------------------------------------------
-- RLS: membros do workspace leem/escrevem; service role ignora RLS.
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'integration_credentials','ad_accounts','pixels','products','offers','campaigns','adsets','creatives','ads',
    'insights_daily','insights_breakdowns_daily','tracking_sites','tracking_sessions','tracking_events','capi_logs',
    'cakto_events_raw','orders','attribution_links','decision_rules','advisor_reports','alerts','user_notes',
    'niches','subniches','ad_references','swipe_collections','campaign_kits','creative_assets','flow_queue',
    'pdf_projects','pdf_versions','sync_jobs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_member_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id))',
      t || '_member_all', t
    );
  end loop;
end $$;

-- Segredos: o navegador nunca lê a coluna criptografada nem o hash de busca.
-- (REVOKE de coluna não vale quando há SELECT na tabela inteira, que o Supabase
-- concede por padrão — por isso revoga tudo e concede só as colunas seguras.)
-- Escritas de credenciais passam sempre pelo servidor (service role).
revoke all on public.integration_credentials from anon, authenticated;
grant select (id, workspace_id, provider, label, meta, expires_at, status, last_checked_at, last_error, created_at, updated_at)
  on public.integration_credentials to authenticated;

alter table public.workspaces enable row level security;
drop policy if exists workspaces_member_select on public.workspaces;
create policy workspaces_member_select on public.workspaces for select to authenticated
  using (public.is_workspace_member(id));
drop policy if exists workspaces_member_update on public.workspaces;
create policy workspaces_member_update on public.workspaces for update to authenticated
  using (public.is_workspace_member(id)) with check (public.is_workspace_member(id));

alter table public.workspace_members enable row level security;
drop policy if exists workspace_members_self on public.workspace_members;
create policy workspace_members_self on public.workspace_members for select to authenticated
  using (user_id = auth.uid() or public.is_workspace_member(workspace_id));

alter table public.users enable row level security;
drop policy if exists users_self on public.users;
create policy users_self on public.users for all to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- Cria workspace + membro owner de forma atômica para o usuário logado.
create or replace function public.create_workspace(p_name text, p_timezone text default 'America/Cuiaba')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare ws uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.workspaces (name, timezone, created_by) values (p_name, p_timezone, auth.uid()) returning id into ws;
  insert into public.workspace_members (workspace_id, user_id, role) values (ws, auth.uid(), 'owner');
  insert into public.users (id) values (auth.uid()) on conflict (id) do nothing;
  return ws;
end $$;

grant execute on function public.create_workspace(text, text) to authenticated;
grant execute on function public.is_workspace_member(uuid) to authenticated;
