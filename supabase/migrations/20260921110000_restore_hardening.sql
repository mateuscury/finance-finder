-- Restore hardening (docs/milestone-4-plan.md D-16, D-17; MILESTONES.md §4
-- decision 52: function bodies only). `restore_backup` is restated whole —
-- a `create or replace` carries the body, not a diff — with two changes,
-- each marked in the body: a per-user advisory lock after the
-- authentication check, and an exception block that turns a refused row
-- into the fixed `restore_refused: invalid_rows` reason. Everything else
-- is byte-identical to 20260920200000_backup_rpcs.sql.

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
  -- Two concurrent restores into one empty account both passed the emptiness
  -- check below and both wrote (Milestone 4 D-17). The lock serialises them
  -- per user for the rest of the transaction: the second waits, then sees
  -- account_not_empty. Keyed by the user id, so users never block each other.
  perform pg_advisory_xact_lock(hashtext(v_uid::text));
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
exception
  -- A row the database refuses — a negative price, an unknown enum value, a
  -- date that does not parse — used to surface as the raw Postgres error
  -- (Milestone 4 D-16). It is now the same fixed shape as every other
  -- refusal; the function's own `restore_refused: …` raises are not in these
  -- classes and pass through untouched. Nothing was written: the whole
  -- function is one transaction and the exception rolls it back.
  when check_violation or not_null_violation or foreign_key_violation or unique_violation
    or invalid_text_representation or numeric_value_out_of_range
    or datetime_field_overflow or invalid_datetime_format then
    raise exception 'restore_refused: invalid_rows';
end;
$$;


-- The privileges are restated because `create or replace` keeps them, and
-- stating them makes this file complete on its own.
revoke all on function public.restore_backup(jsonb) from public, anon, service_role;
grant execute on function public.restore_backup(jsonb) to authenticated;
