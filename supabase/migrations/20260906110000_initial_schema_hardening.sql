-- Forward migration carrying changes that were WRONGLY made by editing
-- 20260905000000_initial_schema.sql in place after it had already been applied.
--
-- That file states its own rule at the top: once any environment has applied it,
-- add columns in a follow-up migration rather than editing it. The edit broke
-- that rule, and because the edited file kept the SAME migration version, no
-- database that had already applied the original would ever receive the changes:
-- `supabase db push` skips a version already in the ledger. Fresh installations
-- and existing ones would have silently diverged — most seriously on
-- `series_points`, whose PRIMARY KEY gained a `tenor_days` column.
--
-- 20260905000000 has been restored to its committed contents, and everything the
-- edit added lives here instead.
--
-- EVERY statement below is idempotent: a database already carrying these changes
-- (a local stack that was reset against the edited file) applies this as a no-op,
-- while one still at the original schema is brought up to date.

-- ---------------------------------------------------------------------------
-- 1. Owner-matching identity. The composite unique key must exist before the
--    composite foreign keys below can reference it.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'assets_id_user_unique' and conrelid = 'public.assets'::regclass) then
    alter table public.assets add constraint assets_id_user_unique unique (id, user_id);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'assets_identity_unique' and conrelid = 'public.assets'::regclass) then
    alter table public.assets add constraint assets_identity_unique unique (user_id, pack_id, instrument_kind, identifier);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Re-point child foreign keys at (id, user_id) so a row can never reference
--    another user's asset.
-- ---------------------------------------------------------------------------
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'transactions_asset_id_fkey' and conrelid = 'public.transactions'::regclass) then
    alter table public.transactions drop constraint transactions_asset_id_fkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'transactions_asset_owner_fk' and conrelid = 'public.transactions'::regclass) then
    alter table public.transactions add constraint transactions_asset_owner_fk
      foreign key (asset_id, user_id) references public.assets (id, user_id) on delete cascade;
  end if;

  if exists (select 1 from pg_constraint where conname = 'portfolio_snapshots_asset_id_fkey' and conrelid = 'public.portfolio_snapshots'::regclass) then
    alter table public.portfolio_snapshots drop constraint portfolio_snapshots_asset_id_fkey;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'snapshots_asset_owner_fk' and conrelid = 'public.portfolio_snapshots'::regclass) then
    alter table public.portfolio_snapshots add constraint snapshots_asset_owner_fk
      foreign key (asset_id, user_id) references public.assets (id, user_id) on delete cascade;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3. Value checks. Added only when absent, so this never drops a live constraint.
-- ---------------------------------------------------------------------------
do $$
declare
  c record;
begin
  for c in
    select * from (values
      ('user_settings',       'user_settings_currency_check',        $c$check (base_currency ~ '^[A-Z]{3}$')$c$),
      ('user_settings',       'user_settings_theme_check',           $c$check (theme in ('system', 'light', 'dark'))$c$),
      ('user_settings',       'user_settings_packs_no_null_check',   $c$check (array_position(enabled_packs, null) is null)$c$),
      ('assets',              'assets_pack_id_check',                $c$check (pack_id ~ '^([a-z]{2}|global)$')$c$),
      ('assets',              'assets_kind_check',                   $c$check (instrument_kind ~ '^([a-z]{2}|global)\.[a-z0-9_]+(\.[a-z0-9_]+)*$')$c$),
      ('assets',              'assets_currency_check',               $c$check (native_currency ~ '^[A-Z]{3}$')$c$),
      ('assets',              'assets_kind_matches_pack_check',      $c$check (instrument_kind like pack_id || '.%')$c$),
      ('assets',              'assets_identifier_check',             $c$check (btrim(identifier) <> '')$c$),
      ('assets',              'assets_name_check',                   $c$check (btrim(name) <> '')$c$),
      ('transactions',        'transactions_quantity_by_type_check', $c$check ((type = 'buy' and quantity > 0) or (type = 'sell' and quantity < 0) or (type in ('dividend', 'interest', 'fee') and quantity = 0))$c$),
      ('transactions',        'transactions_unit_price_check',       $c$check (unit_price > 0)$c$),
      ('transactions',        'transactions_fees_check',             $c$check (fees >= 0)$c$),
      ('transactions',        'transactions_fx_rate_check',          $c$check (fx_rate is null or fx_rate > 0)$c$),
      ('transactions',        'transactions_currency_check',         $c$check (currency ~ '^[A-Z]{3}$')$c$),
      ('cash_flows',          'cash_flows_amount_check',             $c$check (amount <> 0)$c$),
      ('cash_flows',          'cash_flows_currency_check',           $c$check (currency ~ '^[A-Z]{3}$')$c$),
      ('prices',              'prices_value_check',                  $c$check (price > 0)$c$),
      ('prices',              'prices_currency_check',               $c$check (currency ~ '^[A-Z]{3}$')$c$),
      ('prices',              'prices_source_check',                 $c$check (source_id = 'manual' or source_id ~ '^([a-z]{2}|global)\.[a-z0-9_]+(\.[a-z0-9_]+)*$')$c$),
      ('portfolio_snapshots', 'snapshots_price_check',               $c$check (price_native > 0)$c$),
      ('portfolio_snapshots', 'snapshots_fx_rate_check',             $c$check (fx_rate is null or fx_rate > 0)$c$),
      ('portfolio_snapshots', 'snapshots_currency_check',            $c$check (base_currency ~ '^[A-Z]{3}$')$c$)
    ) as t(tbl, name, definition)
  loop
    if not exists (
      select 1 from pg_constraint
      where conname = c.name and conrelid = ('public.' || c.tbl)::regclass
    ) then
      execute format('alter table public.%I add constraint %I %s', c.tbl, c.name, c.definition);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- 4. series_points gains a tenor dimension, and its PRIMARY KEY changes.
--    This is the change that most needed to be a forward migration: a database
--    at the original schema cannot store a yield curve at all, because two
--    tenors on the same date collide on the old (series_id, date) key.
-- ---------------------------------------------------------------------------
alter table public.series_points add column if not exists tenor_days integer not null default 0;

do $$
declare
  pk_name text;
begin
  select conname into pk_name
  from pg_constraint
  where conrelid = 'public.series_points'::regclass and contype = 'p';

  -- Rebuild the key only when tenor_days is not already part of it.
  if pk_name is not null and not exists (
    select 1
    from pg_constraint con
    join pg_attribute att
      on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
    where con.conname = pk_name
      and con.conrelid = 'public.series_points'::regclass
      and att.attname = 'tenor_days'
  ) then
    execute format('alter table public.series_points drop constraint %I', pk_name);
    alter table public.series_points add primary key (series_id, date, tenor_days);
  end if;
end $$;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'series_points_id_check' and conrelid = 'public.series_points'::regclass) then
    alter table public.series_points add constraint series_points_id_check
      check (series_id ~ '^([a-z]{2}|global)\.[a-z0-9_]+(\.[a-z0-9_]+)*$');
  end if;
  if not exists (select 1 from pg_constraint where conname = 'series_points_tenor_check' and conrelid = 'public.series_points'::regclass) then
    alter table public.series_points add constraint series_points_tenor_check check (tenor_days >= 0);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'series_points_value_check' and conrelid = 'public.series_points'::regclass) then
    alter table public.series_points add constraint series_points_value_check check (value <> 'NaN'::numeric);
  end if;
end $$;

-- Redundant with the primary keys, which already serve range scans either way.
drop index if exists public.prices_asset_date_idx;
drop index if exists public.series_points_id_date_idx;

-- ---------------------------------------------------------------------------
-- 5. RLS policies. `(select auth.uid())` is evaluated once per query instead of
--    once per row. Price writes from a client are restricted to `manual`
--    provenance, and snapshots become read-only to their owner.
-- ---------------------------------------------------------------------------
drop policy if exists "own settings"      on public.user_settings;
drop policy if exists "own assets"        on public.assets;
drop policy if exists "own transactions"  on public.transactions;
drop policy if exists "own cash flows"    on public.cash_flows;
drop policy if exists "prices of own assets" on public.prices;
drop policy if exists "own snapshots"     on public.portfolio_snapshots;
drop policy if exists "read prices of own assets"           on public.prices;
drop policy if exists "insert manual prices of own assets"  on public.prices;
drop policy if exists "update prices to manual for own assets" on public.prices;
drop policy if exists "delete manual prices of own assets"  on public.prices;
drop policy if exists "read own snapshots" on public.portfolio_snapshots;

create policy "own settings" on public.user_settings
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own assets" on public.assets
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own transactions" on public.transactions
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "own cash flows" on public.cash_flows
  for all using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create policy "read prices of own assets" on public.prices
  for select using (exists (
    select 1 from public.assets a where a.id = prices.asset_id and a.user_id = (select auth.uid())
  ));
create policy "insert manual prices of own assets" on public.prices
  for insert with check (source_id = 'manual' and exists (
    select 1 from public.assets a where a.id = prices.asset_id and a.user_id = (select auth.uid())
  ));
create policy "update prices to manual for own assets" on public.prices
  for update
  using (exists (
    select 1 from public.assets a where a.id = prices.asset_id and a.user_id = (select auth.uid())
  ))
  with check (source_id = 'manual' and exists (
    select 1 from public.assets a where a.id = prices.asset_id and a.user_id = (select auth.uid())
  ));
create policy "delete manual prices of own assets" on public.prices
  for delete using (source_id = 'manual' and exists (
    select 1 from public.assets a where a.id = prices.asset_id and a.user_id = (select auth.uid())
  ));

create policy "read own snapshots" on public.portfolio_snapshots
  for select using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- 6. Truthful updated_at.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_settings_set_updated_at on public.user_settings;
create trigger user_settings_set_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();
drop trigger if exists assets_set_updated_at on public.assets;
create trigger assets_set_updated_at before update on public.assets
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 7. Snapshots are derived rows: readable by their owner, writable only by the
--    service role.
-- ---------------------------------------------------------------------------
revoke insert, update, delete, truncate, references, trigger
  on public.portfolio_snapshots from anon, authenticated;
grant select on public.portfolio_snapshots to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Draft packs are never enabled by default (PACKS.md §12). The original
--    default of '{br}' would have auto-enabled a draft pack for every new user.
-- ---------------------------------------------------------------------------
alter table public.user_settings alter column enabled_packs set default '{}';
