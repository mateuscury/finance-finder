-- Atomic, manual-safe ingestion commit (docs/milestone-1-plan.md §3.3).
--
-- ONE database transaction performs all four writes of an ingestion chunk, so
-- data and resume markers can never diverge: a run that stored prices but
-- crashed before advancing its watermark would re-fetch and re-write forever,
-- and one that advanced a watermark before storing would skip a day silently.
--
-- Every numeric value arrives as JSON *text* and is cast to numeric here.
-- Reading it as a JSON number would route the value through a float first,
-- which is exactly what the decimal-string boundary exists to prevent
-- (CLAUDE.md non-negotiables).
--
-- Returns COUNTS ONLY. No row values ever leave this function: the cron route
-- logs its result, and logs must never carry a price or a quantity (SPEC §12).

create or replace function public.commit_ingest_chunk(payload jsonb)
returns jsonb
language plpgsql
-- Invoker rights: only service_role is granted EXECUTE, and service_role
-- already bypasses RLS. Making this SECURITY DEFINER would hand a privilege
-- escalation to anyone who ever gained EXECUTE by mistake.
security invoker
set search_path = ''
as $$
declare
  v_source_id       text := payload->>'source_id';
  v_prices_in       integer := 0;
  v_prices_written  integer := 0;
  v_manual_kept     integer := 0;
  v_series_written  integer := 0;
  v_watermarks      integer := 0;
begin
  if v_source_id is null then
    raise exception 'commit_ingest_chunk: source_id is required';
  end if;

  -- 1. Asset prices. A user's own price ALWAYS wins: the conflict clause
  --    refuses to overwrite a row whose provenance is 'manual'. This is the
  --    single most important line in the file — a user who corrected a price by
  --    hand must never see the next cron run silently undo it.
  with incoming as (
    select (e->>'asset_id')::uuid   as asset_id,
           (e->>'date')::date       as date,
           (e->>'price')::numeric   as price,
           (e->>'currency')::char(3) as currency
    from jsonb_array_elements(coalesce(payload->'prices', '[]'::jsonb)) as e
  ),
  counted as (select count(*)::integer as n from incoming),
  upserted as (
    insert into public.prices (asset_id, date, price, currency, source_id)
    select asset_id, date, price, currency, v_source_id from incoming
    on conflict (asset_id, date) do update
      set price     = excluded.price,
          currency  = excluded.currency,
          source_id = excluded.source_id
      where public.prices.source_id <> 'manual'
    returning 1
  )
  select (select n from counted), (select count(*)::integer from upserted)
    into v_prices_in, v_prices_written;

  -- Rows the conflict clause declined to touch were user-authored.
  v_manual_kept := v_prices_in - v_prices_written;

  -- 2. Series points. Global market data, no user scope; last write wins.
  with upserted as (
    insert into public.series_points (series_id, date, value, tenor_days)
    select e->>'series_id',
           (e->>'date')::date,
           (e->>'value')::numeric,
           coalesce((e->>'tenor_days')::integer, 0)
    from jsonb_array_elements(coalesce(payload->'series_points', '[]'::jsonb)) as e
    on conflict (series_id, date, tenor_days) do update
      set value = excluded.value
    returning 1
  )
  select count(*)::integer from upserted into v_series_written;

  -- 3. Watermarks — ONLY the refs the caller reports as successful. A ref whose
  --    request failed, aborted, or returned rejected output is simply absent
  --    from this array, so its resume point stays where it was.
  with upserted as (
    insert into public.ingest_watermarks (
      source_id, capability, ref, target_from, last_date, unavailable_before, last_run_at
    )
    select v_source_id,
           e->>'capability',
           e->>'ref',
           (e->>'target_from')::date,
           (e->>'last_date')::date,
           (e->>'unavailable_before')::date,
           now()
    from jsonb_array_elements(coalesce(payload->'watermarks', '[]'::jsonb)) as e
    on conflict (source_id, capability, ref) do update
      set target_from = excluded.target_from,
          last_date = case
            -- RESTART. `target_from` moved EARLIER, which only happens when a
            -- newly created asset needs history before the previous target. The
            -- scheduler has restarted this ref's forward cursor at that earlier
            -- date, so the high-water mark must follow it DOWN.
            --
            -- Taking greatest() here instead would keep the old, higher
            -- last_date and declare the entire span between the new target and
            -- the old mark ingested when it was never fetched — a permanent,
            -- silent hole in that asset's price history.
            when excluded.target_from < public.ingest_watermarks.target_from
              then excluded.last_date
            -- Normal progress: never rewind. A late or partial chunk must not
            -- drag back a ref that is already further ahead.
            else greatest(public.ingest_watermarks.last_date, excluded.last_date)
          end,
          unavailable_before = excluded.unavailable_before,
          last_run_at = excluded.last_run_at
    returning 1
  )
  select count(*)::integer from upserted into v_watermarks;

  -- 4. Source cursor: scheduling order and user-facing status. `last_date` here
  --    is a SUMMARY (the minimum committed watermark), never the resume truth.
  insert into public.ingest_cursors (source_id, last_date, last_run_at, last_error)
  values (
    v_source_id,
    (payload#>>'{cursor,last_date}')::date,
    now(),
    payload#>>'{cursor,last_error}'
  )
  on conflict (source_id) do update
    set last_date   = excluded.last_date,
        last_run_at = excluded.last_run_at,
        last_error  = excluded.last_error;

  return jsonb_build_object(
    'prices_written',    v_prices_written,
    'manual_protected',  v_manual_kept,
    'series_written',    v_series_written,
    'watermarks_advanced', v_watermarks
  );
end;
$$;

comment on function public.commit_ingest_chunk(jsonb) is
  'Atomic ingestion commit: prices (never overwriting manual), series points, successful watermarks, source cursor. Returns counts only.';

-- Only the cron service role may call this. PUBLIC gets EXECUTE on new
-- functions by default, so the revoke is mandatory, not decorative.
revoke all on function public.commit_ingest_chunk(jsonb) from public, anon, authenticated;
grant execute on function public.commit_ingest_chunk(jsonb) to service_role;
