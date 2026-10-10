-- =====================================================================
-- Auditoria de confiabilidade (P0/P1)
-- =====================================================================

-- ---- Composição do pedido: produto principal x order bump x upsell ----
alter table public.orders add column if not exists order_kind text not null default 'main'
  check (order_kind in ('main','bump','upsell'));
alter table public.orders add column if not exists main_amount numeric(12,2) not null default 0;
alter table public.orders add column if not exists bump_amount numeric(12,2) not null default 0;
alter table public.orders add column if not exists upsell_amount numeric(12,2) not null default 0;
alter table public.orders add column if not exists items jsonb;
-- Pedidos antigos: todo o valor era tratado como produto principal
update public.orders set main_amount = gross_amount where main_amount = 0 and bump_amount = 0 and upsell_amount = 0 and order_kind = 'main';

-- ---- Produto: papel e custos variáveis (para lucro de contribuição) ----
alter table public.products add column if not exists kind text not null default 'principal'
  check (kind in ('principal','order_bump','upsell'));
-- Custo fixo por venda (ex.: entrega, ferramenta por aluno) e % sobre o faturamento (ex.: coprodução, afiliados)
alter table public.products add column if not exists cost_per_sale numeric(12,2) not null default 0;
alter table public.products add column if not exists cost_pct numeric(6,4) not null default 0;

-- ---- Câmbio por conta de anúncios ----
-- fx_mode: auto = cotação PTAX (Banco Central) do dia; manual = taxa fixa informada
alter table public.ad_accounts add column if not exists fx_mode text not null default 'auto' check (fx_mode in ('auto','manual'));
alter table public.ad_accounts add column if not exists fx_manual_rate numeric(12,6);
-- IOF + spread do cartão sobre a cobrança internacional (0.035 = 3,5%)
alter table public.ad_accounts add column if not exists fx_spread_pct numeric(6,4) not null default 0.035;

-- Cotações (globais, não pertencem a um workspace)
create table if not exists public.fx_rates (
  date date not null,
  base text not null,
  quote text not null,
  rate numeric(14,6) not null,
  source text not null,
  fetched_at timestamptz not null default now(),
  primary key (date, base, quote)
);
alter table public.fx_rates enable row level security;
drop policy if exists fx_rates_read on public.fx_rates;
create policy fx_rates_read on public.fx_rates for select to authenticated using (true);

-- ---- Webhooks: contagem de entregas duplicadas (qualidade dos dados) ----
alter table public.cakto_events_raw add column if not exists duplicate_count int not null default 0;
