-- Milestone 3 snapshot invariant and columns (docs/milestone-3-plan.md
-- "The snapshot invariant"; MILESTONES.md §3 decisions 20, 22, 24).

-- ---------------------------------------------------------------------------
-- 1. A snapshot row explains itself (decision 22, amending Milestone 2
--    decision 6): the observation dates behind it and the kernel's own
--    status. A reader that re-derived staleness from price_date would need
--    the pack window and calendar; one that forgot would show a stale value
--    as confident — the exact SPEC §11 failure. Nothing has written this
--    table yet, so the columns can be added without a backfill.
-- ---------------------------------------------------------------------------
alter table public.portfolio_snapshots add column if not exists price_date date;
alter table public.portfolio_snapshots add column if not exists fx_date    date;
alter table public.portfolio_snapshots add column if not exists status     text not null default 'ok';
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'snapshots_status_check' and conrelid = 'public.portfolio_snapshots'::regclass) then
    alter table public.portfolio_snapshots add constraint snapshots_status_check
      check (status in ('ok', 'carried_forward', 'stale'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. The CSV column mapping a user chose once (decision 24). Not in the
--    backup: a convenience, not ledger data.
-- ---------------------------------------------------------------------------
alter table public.user_settings add column if not exists csv_column_map jsonb;

-- ---------------------------------------------------------------------------
-- 3. Invalidation (decision 20). SPEC §8 and §11: a write that changes
--    history deletes every snapshot from the earliest touched date forward,
--    never patched in place, never left stale. The snapshot job's marker is
--    per USER (max snapshot date + 1), so the delete covers every asset of
--    that user from the date on — deleting one asset's rows would leave the
--    marker at today and the change would never be rebuilt.
--
--    SECURITY DEFINER because the writer is usually an authenticated client
--    (a form, a CSV commit, a manual price) that holds no privilege on
--    portfolio_snapshots at all — the initial migration revoked every write.
--    The function touches nothing but the invalidation itself.
-- ---------------------------------------------------------------------------
create or replace function public.invalidate_snapshots()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_from date;
begin
  if tg_table_name = 'transactions' then
    v_user := coalesce(new.user_id, old.user_id);
    v_from := least(new.trade_date, old.trade_date);
  elsif tg_table_name = 'prices' then
    select a.user_id into v_user from public.assets a where a.id = coalesce(new.asset_id, old.asset_id);
    v_from := least(new.date, old.date);
  elsif tg_table_name = 'user_settings' then
    -- Only a base currency change rewrites history; every row is in the old base.
    if new.base_currency is not distinct from old.base_currency then
      return null;
    end if;
    v_user := new.user_id;
    v_from := null;
  else
    return null;
  end if;

  if v_user is null then
    return null;
  end if;
  if v_from is null then
    delete from public.portfolio_snapshots s where s.user_id = v_user;
  else
    delete from public.portfolio_snapshots s where s.user_id = v_user and s.date >= v_from;
  end if;
  return null;
end;
$$;

comment on function public.invalidate_snapshots() is
  'AFTER-row trigger: drops the user''s portfolio_snapshots from the touched date forward (all of them on a base currency change).';

revoke all on function public.invalidate_snapshots() from public, anon, authenticated, service_role;

drop trigger if exists transactions_invalidate_snapshots on public.transactions;
create trigger transactions_invalidate_snapshots
  after insert or update or delete on public.transactions
  for each row execute function public.invalidate_snapshots();

drop trigger if exists prices_invalidate_snapshots on public.prices;
create trigger prices_invalidate_snapshots
  after insert or update or delete on public.prices
  for each row execute function public.invalidate_snapshots();

drop trigger if exists user_settings_invalidate_snapshots on public.user_settings;
create trigger user_settings_invalidate_snapshots
  after update of base_currency on public.user_settings
  for each row execute function public.invalidate_snapshots();
