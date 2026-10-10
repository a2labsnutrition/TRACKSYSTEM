-- =====================================================================
-- Fase 2 — Inteligência
-- =====================================================================

-- Eventos de entidade (linha do tempo): mudanças de orçamento, status,
-- criativos novos, edição de público, saída da fase de aprendizado.
create table if not exists public.entity_events (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  id text not null, -- hash estável (evita duplicar ao ressincronizar)
  campaign_id text,
  adset_id text,
  ad_id text,
  event_type text not null,
  label text not null,
  source text not null default 'meta_activity', -- meta_activity | sync_detected
  event_time timestamptz not null,
  extra jsonb,
  created_at timestamptz not null default now(),
  primary key (workspace_id, id)
);
create index if not exists entity_events_campaign_idx on public.entity_events (workspace_id, campaign_id, event_time desc);

alter table public.entity_events enable row level security;
drop policy if exists entity_events_member_all on public.entity_events;
create policy entity_events_member_all on public.entity_events for all to authenticated
  using (public.is_workspace_member(workspace_id)) with check (public.is_workspace_member(workspace_id));

-- Alertas: chave de deduplicação (tipo + entidade + dia) e notificação
alter table public.alerts add column if not exists dedupe_key text;
alter table public.alerts add column if not exists notified_at timestamptz;
create unique index if not exists alerts_dedupe_idx on public.alerts (workspace_id, dedupe_key);
create index if not exists alerts_open_idx on public.alerts (workspace_id, status, created_at desc);

-- Canais de notificação do workspace: {"emails": [...], "telegramChatId": "...", "minSeverity": "atencao"}
alter table public.workspaces add column if not exists notify jsonb not null default '{}'::jsonb;

-- Metas do motor de decisão por produto (uma linha por produto)
create unique index if not exists decision_rules_product_idx on public.decision_rules (workspace_id, product_id);

-- Parecer: o veredito das regras e o da IA ficam lado a lado
alter table public.advisor_reports add column if not exists rules_status text;
alter table public.advisor_reports add column if not exists created_by uuid;
create index if not exists advisor_reports_campaign_idx on public.advisor_reports (workspace_id, campaign_id, created_at desc);

-- Breakdowns: consulta por campanha e período
create index if not exists insights_breakdowns_entity_idx on public.insights_breakdowns_daily (workspace_id, entity_id, breakdown, date);
