-- Initial schema — Finance Finder.
--
-- Precedence (CLAUDE.md "Document precedence"): PACKS.md and this migration are
-- the source of truth for the pack-aware schema shape (assets, prices,
-- series_points, ingest_cursors). SPEC.md supplies the FEATURE requirements the
-- schema must serve: the closed set of transaction types, cash flows for
-- TWR/MWR, per-asset snapshots for contribution, user-entered manual prices,
-- and the theme setting. Reconciled 2026-09-05.
--
-- Packs ship ZERO migrations (PACKS.md §3). Once any environment has applied
-- this file, add columns in a follow-up migration rather than editing it.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Closed set of ledger event types (SPEC.md §2, §11). dividend / interest / fee
-- affect MWR and cash, never quantity.
-- ---------------------------------------------------------------------------
create type public.txn_type as enum ('buy', 'sell', 'dividend', 'interest', 'fee');

-- ---------------------------------------------------------------------------
-- user_settings (PACKS.md §3.3; theme per SPEC.md §9 screen 9)
-- ---------------------------------------------------------------------------
create table public.user_settings (
  user_id        uuid primary key references auth.users (id) on delete cascade,
  base_currency  char(3) not null default 'BRL',   -- display currency (ARCHITECTURE §4.2)
  -- Pack dependencies (e.g. br → global for USDBRL) are activated transitively
  -- by lib/packs/activate.ts; users only list the markets they hold.
  enabled_packs  text[]  not null default '{br}',
  locale         text    not null default 'pt-BR',  -- number/date formatting only
  theme          text    not null default 'system', -- 'system' | 'light' | 'dark'
  last_export_at timestamptz,                       -- backup reminder (SPEC §12.3); null = never exported
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
  native_currency  char(3) not null,              -- ISO 4217, validated in app
  metadata         jsonb not null default '{}',   -- validated by the pack's zod schema, never by the DB
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index assets_pack_kind_idx on public.assets (pack_id, instrument_kind);
create index assets_user_idx on public.assets (user_id);

-- ---------------------------------------------------------------------------
-- transactions — the event-sourced ledger (ARCHITECTURE §4.1).
-- PACKS.md §3.5: untouchable by packs; positions are derived, never stored.
-- ---------------------------------------------------------------------------
create table public.transactions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  asset_id    uuid not null references public.assets (id) on delete cascade,
  trade_date  date not null,
  type        public.txn_type not null,
  quantity    numeric(24,10) not null,            -- signed: buy +, sell −; 0 for dividend/interest/fee
  unit_price  numeric(24,10) not null,            -- native currency, per unit (or the cash amount for dividend/interest/fee)
  currency    char(3) not null,                   -- quote currency at trade time
  fees        numeric(24,10) not null default 0,
  fx_rate     numeric(24,10),                     -- native→base on trade day; null when native == base (SPEC §1.2)
  note        text,
  created_at  timestamptz not null default now()
);
create index transactions_user_asset_date_idx on public.transactions (user_id, asset_id, trade_date);
create index transactions_user_date_idx       on public.transactions (user_id, trade_date desc);

-- ---------------------------------------------------------------------------
-- cash_flows — external deposits / withdrawals that break TWR sub-periods and
-- feed MWR/XIRR (SPEC.md §6, screen 8).
-- ---------------------------------------------------------------------------
create table public.cash_flows (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  date        date not null,
  amount      numeric(24,10) not null,            -- + deposit, − withdrawal
  currency    char(3) not null,
  note        text,
  created_at  timestamptz not null default now()
);
create index cash_flows_user_date_idx on public.cash_flows (user_id, date desc);

-- ---------------------------------------------------------------------------
-- prices (PACKS.md §3.4) — currency denormalized on purpose: an instrument's
-- quote currency can change and history must keep the currency it was quoted in.
-- source_id is a pack source id ('br.brapi') or 'manual' for user-entered prices.
-- ---------------------------------------------------------------------------
create table public.prices (
  asset_id  uuid not null references public.assets (id) on delete cascade,
  date      date not null,
  price     numeric(24,10) not null,              -- native currency
  currency  char(3) not null,
  source_id text not null default 'manual',
  primary key (asset_id, date)
);
create index prices_asset_date_idx on public.prices (asset_id, date desc);

-- ---------------------------------------------------------------------------
-- series_points (PACKS.md §3.2) — GLOBAL PUBLIC MARKET DATA, NOT USER DATA.
--
-- This table intentionally has NO user_id and NO row-level security.
-- ARCHITECTURE §4.3 (RLS on every table) applies to user-scoped tables only.
-- Writes come exclusively from cron via the service role. Reads are public
-- within the app. Do NOT "fix" this by adding RLS or a user_id column.
--
-- Supabase grants anon/authenticated ALL privileges on new public tables by
-- default, so the grants block at the end of this file revokes writes; without
-- it any holder of the anon key could write market data through PostgREST.
-- ---------------------------------------------------------------------------
create table public.series_points (
  series_id text not null,                        -- 'br.cdi', 'uk.sonia', 'global.usdbrl'
  date      date not null,
  value     numeric(24,10) not null,
  primary key (series_id, date)
);
create index series_points_id_date_idx on public.series_points (series_id, date desc);

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
-- One row per (user, asset, day) so Contribution and Attribution (SPEC §6) can
-- read per-asset history; write-once and reproducible from
-- transactions + prices + series_points.
-- ---------------------------------------------------------------------------
create table public.portfolio_snapshots (
  user_id            uuid not null references auth.users (id) on delete cascade,
  asset_id           uuid not null references public.assets (id) on delete cascade,
  date               date not null,
  quantity           numeric(24,10) not null,
  price_native       numeric(24,10) not null,
  fx_rate            numeric(24,10),              -- null when native == base
  base_currency      char(3) not null,            -- the base this row was converted into (SPEC §11 lock rule)
  market_value_base  numeric(24,10) not null,
  -- PACKS.md §8 / SPEC §11: a snapshot records when it was built on
  -- carried-forward price or FX inputs. The UI shows it as stale, never as a
  -- confident number.
  carried_forward    boolean not null default false,
  created_at         timestamptz not null default now(),
  primary key (user_id, asset_id, date)
);
create index snapshots_user_date_idx on public.portfolio_snapshots (user_id, date desc);

-- ---------------------------------------------------------------------------
-- Row-level security — user-scoped tables only (ARCHITECTURE §4.3).
-- ---------------------------------------------------------------------------
alter table public.user_settings       enable row level security;
alter table public.assets              enable row level security;
alter table public.transactions        enable row level security;
alter table public.cash_flows          enable row level security;
alter table public.prices              enable row level security;
alter table public.portfolio_snapshots enable row level security;
-- series_points and ingest_cursors: no RLS by design (see above). Only the
-- service role can write; see the grants block below.

create policy "own settings" on public.user_settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own assets" on public.assets
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own transactions" on public.transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "own cash flows" on public.cash_flows
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- prices are scoped through the parent asset. Users may read pack-ingested
-- prices and write 'manual' ones for their own assets (SPEC §2).
create policy "prices of own assets" on public.prices
  for all
  using      (exists (select 1 from public.assets a where a.id = prices.asset_id and a.user_id = auth.uid()))
  with check (exists (select 1 from public.assets a where a.id = prices.asset_id and a.user_id = auth.uid()));

create policy "own snapshots" on public.portfolio_snapshots
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Grants for the two non-RLS tables. The service role bypasses grants and RLS.
-- ---------------------------------------------------------------------------
revoke all    on public.series_points  from anon, authenticated;
grant  select on public.series_points  to   authenticated;
revoke all    on public.ingest_cursors from anon, authenticated;
