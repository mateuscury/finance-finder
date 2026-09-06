-- Initial schema — Finance Finder.
--
-- Source of truth for the pack-aware columns: PACKS.md §3. All five changes are
-- applied here, in the FIRST migration, so no pack ever ships SQL.
--
-- !! The base column sets of assets / prices / transactions / portfolio_snapshots
-- !! / user_settings come from SPEC.md, which is not yet in this repo. They are
-- !! kept deliberately minimal here. Reconcile against SPEC.md before Milestone 1
-- !! ships; add columns in a follow-up migration rather than editing this one
-- !! once any environment has applied it.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- user_settings (PACKS.md §3.3)
-- ---------------------------------------------------------------------------
create table public.user_settings (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  base_currency  char(3) not null default 'BRL',   -- display currency; ARCHITECTURE §4.2 constant → setting
  enabled_packs  text[]  not null default '{br}',
  locale         text    not null default 'pt-BR',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- assets (PACKS.md §3.1) — pack-aware; NO Brazil-specific asset-class enum.
-- ---------------------------------------------------------------------------
create table public.assets (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users (id) on delete cascade,
  pack_id          text not null,                 -- 'br', 'uk', 'global'
  instrument_kind  text not null,                 -- 'br.tesouro_direto'
  identifier       text not null,                 -- ISIN / ticker / custom, per InstrumentKind.identifier
  name             text not null,
  native_currency  char(3) not null,              -- ISO 4217
  metadata         jsonb not null default '{}',   -- validated by the pack's zod schema, never by the DB
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index assets_pack_kind_idx on public.assets (pack_id, instrument_kind);
create index assets_user_idx on public.assets (user_id);

-- ---------------------------------------------------------------------------
-- transactions (PACKS.md §3.5: untouchable by packs; positions are derived).
-- Base columns per SPEC.md — minimal placeholder, see header.
-- ---------------------------------------------------------------------------
create table public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  asset_id    uuid not null references public.assets (id) on delete cascade,
  trade_date  date not null,
  type        text not null,                      -- SPEC.md defines the closed set
  quantity    numeric(24,10) not null,
  unit_price  numeric(24,10) not null,            -- in the asset's native currency
  currency    char(3) not null,
  fees        numeric(24,10) not null default 0,
  note        text,
  created_at  timestamptz not null default now()
);
create index transactions_user_asset_date_idx on public.transactions (user_id, asset_id, trade_date);

-- ---------------------------------------------------------------------------
-- prices (PACKS.md §3.4) — currency denormalized on purpose: an instrument's
-- quote currency can change and history must keep the currency it was quoted in.
-- ---------------------------------------------------------------------------
create table public.prices (
  asset_id  uuid not null references public.assets (id) on delete cascade,
  date      date not null,
  price     numeric(24,10) not null,              -- native currency
  currency  char(3) not null,
  source_id text not null,                        -- 'br.brapi'
  primary key (asset_id, date)
);

-- ---------------------------------------------------------------------------
-- series_points (PACKS.md §3.2) — GLOBAL PUBLIC MARKET DATA, NOT USER DATA.
--
-- This table intentionally has NO user_id and NO row-level security.
-- ARCHITECTURE §4.3 (RLS on every table) applies to user-scoped tables only.
-- Writes come exclusively from cron via the service role. Reads are public
-- within the app. Do NOT "fix" this by adding RLS or a user_id column.
-- ---------------------------------------------------------------------------
create table public.series_points (
  series_id text not null,                        -- 'br.cdi', 'uk.sonia', 'global.usdbrl'
  date      date not null,
  value     numeric(24,10) not null,
  primary key (series_id, date)
);

-- Ingestion bookkeeping for the single-invocation price job (PACKS.md §10):
-- per-source resume markers so a run can pick up where the time budget cut it.
create table public.ingest_cursors (
  source_id   text primary key,                   -- 'br.bcb_sgs'
  last_date   date,
  last_run_at timestamptz,
  last_error  text
);

-- ---------------------------------------------------------------------------
-- portfolio_snapshots (PACKS.md §3.5: unchanged by packs).
-- ---------------------------------------------------------------------------
create table public.portfolio_snapshots (
  user_id            uuid not null references auth.users (id) on delete cascade,
  date               date not null,
  base_currency      char(3) not null,
  total_value        numeric(24,10) not null,
  -- PACKS.md §8: a snapshot records when it was built on carried-forward inputs.
  carried_forward    boolean not null default false,
  stale_asset_ids    uuid[] not null default '{}',
  payload            jsonb not null default '{}', -- per-asset breakdown, SPEC.md shape
  created_at         timestamptz not null default now(),
  primary key (user_id, date)
);

-- ---------------------------------------------------------------------------
-- Row-level security — user-scoped tables only (ARCHITECTURE §4.3).
-- ---------------------------------------------------------------------------
alter table public.user_settings       enable row level security;
alter table public.assets              enable row level security;
alter table public.transactions        enable row level security;
alter table public.prices              enable row level security;
alter table public.portfolio_snapshots enable row level security;
-- series_points and ingest_cursors: no RLS by design (see above). Only the
-- service role can write; anon/authenticated get read via grants below.

create policy "own settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own assets" on public.assets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own transactions" on public.transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- prices are keyed by asset; a user sees prices for their own assets.
create policy "prices of own assets" on public.prices
  for select using (exists (select 1 from public.assets a where a.id = prices.asset_id and a.user_id = auth.uid()));

create policy "own snapshots" on public.portfolio_snapshots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select on public.series_points to authenticated;
revoke all on public.ingest_cursors from anon, authenticated;
