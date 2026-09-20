-- Backup export and restore (root SPEC §12.3; docs/milestone-2-plan.md
-- Phase 6; MILESTONES.md §2 decisions 3, 4, 11, 18).
--
-- Every numeric leaves as TEXT and comes back through ::numeric, so no money
-- value ever passes through a JSON number (CLAUDE.md non-negotiables).
-- Timestamps are formatted in UTC with microseconds so two exports of the
-- same rows are byte-identical. Neither function touches `series_points`,
-- `ingest_*` or `portfolio_snapshots`: the first is not user data, the last
-- is derived and rebuilt.

-- ---------------------------------------------------------------------------
-- export_backup(): the caller's whole ledger. SECURITY INVOKER — RLS scopes
-- every table read to auth.uid(), and the service role (which bypasses RLS)
-- is deliberately not granted EXECUTE: an export is always one user's own.
-- ---------------------------------------------------------------------------
create or replace function public.export_backup()
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select jsonb_build_object(
    'version', 1,
    'exported_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'settings', (
      select jsonb_build_object(
        'base_currency', s.base_currency,
        'enabled_packs', to_jsonb(s.enabled_packs),
        'locale', s.locale,
        'theme', s.theme
      )
      from public.user_settings s
      where s.user_id = auth.uid()
    ),
    'assets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id,
        'pack_id', a.pack_id,
        'instrument_kind', a.instrument_kind,
        'identifier', a.identifier,
        'name', a.name,
        'native_currency', a.native_currency,
        'metadata', a.metadata,
        'created_at', to_char(a.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
        'updated_at', to_char(a.updated_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ) order by a.id)
      from public.assets a
      where a.user_id = auth.uid()
    ), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id,
        'asset_id', t.asset_id,
        'trade_date', t.trade_date,
        'type', t.type,
        'quantity', t.quantity::text,
        'unit_price', t.unit_price::text,
        'currency', t.currency,
        'fees', t.fees::text,
        'fx_rate', t.fx_rate::text,
        'note', t.note,
        'created_at', to_char(t.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ) order by t.trade_date, t.id)
      from public.transactions t
      where t.user_id = auth.uid()
    ), '[]'::jsonb),
    'cash_flows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'date', f.date,
        'amount', f.amount::text,
        'currency', f.currency,
        'note', f.note,
        'created_at', to_char(f.created_at at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      ) order by f.date, f.id)
      from public.cash_flows f
      where f.user_id = auth.uid()
    ), '[]'::jsonb),
    -- EVERY price row, with its provenance (decision 3): ingested history the
    -- source can no longer serve would otherwise be lost with the database.
    'prices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'asset_id', p.asset_id,
        'date', p.date,
        'price', p.price::text,
        'currency', p.currency,
        'source_id', p.source_id
      ) order by p.asset_id, p.date)
      from public.prices p
      join public.assets a on a.id = p.asset_id
      where a.user_id = auth.uid()
    ), '[]'::jsonb)
  );
$$;

comment on function public.export_backup() is
  'The caller''s complete ledger as backup v1: settings, assets, transactions, cash flows, every price with source_id. Numerics as text.';

-- Supabase's default privileges also hand service_role EXECUTE on every new
-- function, so it must be revoked by name, not only through PUBLIC.
revoke all on function public.export_backup() from public, anon, service_role;
grant execute on function public.export_backup() to authenticated;

-- ---------------------------------------------------------------------------
-- restore_backup(payload): all-or-nothing restore into an EMPTY account.
--
-- SECURITY DEFINER (decision 11): the `prices` insert policy admits only
-- source_id = 'manual' from a client, so an invoker function could not restore
-- the ingested rows decision 3 exports. Running as the table owner bypasses
-- RLS, which makes THIS BODY the trust boundary. It therefore:
--   (a) refuses when the caller is not authenticated;
--   (b) refuses a non-empty account — assets, transactions OR cash flows
--       (cash flows do not hang off assets, so an asset check alone misses them);
--   (c) refuses any asset id that already exists for ANY user, with a fixed
--       reason rather than a raw primary-key error;
--   (d) refuses a transaction or price naming an asset outside the restored
--       set, so a file can never attach rows to another user's asset;
--   (e) writes auth.uid() as every row's user_id — the file's ids are
--       preserved, its ownership is not.
-- One statement raises, the whole function rolls back: nothing is written.
-- ---------------------------------------------------------------------------
create or replace function public.restore_backup(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid          uuid := auth.uid();
  v_assets       jsonb := coalesce(payload->'assets', '[]'::jsonb);
  v_transactions jsonb := coalesce(payload->'transactions', '[]'::jsonb);
  v_cash_flows   jsonb := coalesce(payload->'cash_flows', '[]'::jsonb);
  v_prices       jsonb := coalesce(payload->'prices', '[]'::jsonb);
  v_settings     jsonb := payload->'settings';
  n_assets       integer := 0;
  n_transactions integer := 0;
  n_cash_flows   integer := 0;
  n_prices       integer := 0;
begin
  if v_uid is null then
    raise exception 'restore_refused: not_authenticated';
  end if;
  if (payload->>'version') is distinct from '1' then
    raise exception 'restore_refused: unsupported_version';
  end if;

  if exists (select 1 from public.assets       where user_id = v_uid)
  or exists (select 1 from public.transactions where user_id = v_uid)
  or exists (select 1 from public.cash_flows   where user_id = v_uid) then
    raise exception 'restore_refused: account_not_empty';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_assets) e
    group by e->>'id' having count(*) > 1
  ) then
    raise exception 'restore_refused: duplicate_asset_id';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_assets) e
    join public.assets a on a.id = (e->>'id')::uuid
  ) then
    raise exception 'restore_refused: asset_id_conflict';
  end if;

  if exists (
    select 1 from jsonb_array_elements(v_transactions) t
    where not exists (select 1 from jsonb_array_elements(v_assets) a where a->>'id' = t->>'asset_id')
  ) or exists (
    select 1 from jsonb_array_elements(v_prices) p
    where not exists (select 1 from jsonb_array_elements(v_assets) a where a->>'id' = p->>'asset_id')
  ) then
    raise exception 'restore_refused: foreign_asset_reference';
  end if;

  -- Settings: upsert, because a bootstrapped account may already have a row.
  -- last_export_at is not in the file (decision 18) and is left alone.
  if v_settings is not null and jsonb_typeof(v_settings) = 'object' then
    insert into public.user_settings (user_id, base_currency, enabled_packs, locale, theme)
    values (
      v_uid,
      v_settings->>'base_currency',
      coalesce(array(select jsonb_array_elements_text(v_settings->'enabled_packs')), '{}'::text[]),
      v_settings->>'locale',
      v_settings->>'theme'
    )
    on conflict (user_id) do update
      set base_currency = excluded.base_currency,
          enabled_packs = excluded.enabled_packs,
          locale        = excluded.locale,
          theme         = excluded.theme;
  end if;

  -- Dependency order: assets, then everything that references them.
  with inserted as (
    insert into public.assets (id, user_id, pack_id, instrument_kind, identifier, name, native_currency, metadata, created_at, updated_at)
    select (e->>'id')::uuid,
           v_uid,
           e->>'pack_id',
           e->>'instrument_kind',
           e->>'identifier',
           e->>'name',
           e->>'native_currency',
           coalesce(e->'metadata', '{}'::jsonb),
           (e->>'created_at')::timestamptz,
           (e->>'updated_at')::timestamptz
    from jsonb_array_elements(v_assets) e
    returning 1
  )
  select count(*)::integer from inserted into n_assets;

  with inserted as (
    insert into public.transactions (id, user_id, asset_id, trade_date, type, quantity, unit_price, currency, fees, fx_rate, note, created_at)
    select (e->>'id')::uuid,
           v_uid,
           (e->>'asset_id')::uuid,
           (e->>'trade_date')::date,
           (e->>'type')::public.txn_type,
           (e->>'quantity')::numeric,
           (e->>'unit_price')::numeric,
           e->>'currency',
           coalesce((e->>'fees')::numeric, 0),
           (e->>'fx_rate')::numeric,
           e->>'note',
           (e->>'created_at')::timestamptz
    from jsonb_array_elements(v_transactions) e
    returning 1
  )
  select count(*)::integer from inserted into n_transactions;

  with inserted as (
    insert into public.cash_flows (id, user_id, date, amount, currency, note, created_at)
    select (e->>'id')::uuid,
           v_uid,
           (e->>'date')::date,
           (e->>'amount')::numeric,
           e->>'currency',
           e->>'note',
           (e->>'created_at')::timestamptz
    from jsonb_array_elements(v_cash_flows) e
    returning 1
  )
  select count(*)::integer from inserted into n_cash_flows;

  with inserted as (
    insert into public.prices (asset_id, date, price, currency, source_id)
    select (e->>'asset_id')::uuid,
           (e->>'date')::date,
           (e->>'price')::numeric,
           e->>'currency',
           coalesce(e->>'source_id', 'manual')
    from jsonb_array_elements(v_prices) e
    returning 1
  )
  select count(*)::integer from inserted into n_prices;

  -- Counts only: no row value ever leaves this function (SPEC §12).
  return jsonb_build_object(
    'assets', n_assets,
    'transactions', n_transactions,
    'cash_flows', n_cash_flows,
    'prices', n_prices
  );
end;
$$;

comment on function public.restore_backup(jsonb) is
  'All-or-nothing restore of backup v1 into the caller''s EMPTY account. Definer rights; enforces ownership itself. Returns counts only.';

-- PUBLIC gets EXECUTE on new functions by default, so the revoke is mandatory.
-- The service role is not granted either: a restore is always a user's own act.
revoke all on function public.restore_backup(jsonb) from public, anon, service_role;
grant execute on function public.restore_backup(jsonb) to authenticated;
