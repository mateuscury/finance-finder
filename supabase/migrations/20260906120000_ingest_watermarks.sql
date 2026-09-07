-- Per-ref ingestion resume markers (docs/milestone-1-plan.md §0.2).
--
-- FORWARD migration, not an edit to 20260905000000_initial_schema.sql: that
-- file is already applied (supabase_migrations.schema_migrations carries
-- 20260905000000 in the local stack), so the initial schema is now frozen per
-- its own header and PACKS.md §3.
--
-- Why `ingest_cursors` was not enough: its `last_date` is ONE value per source,
-- but a source serves many refs across many capabilities. It cannot tell an
-- already-backfilled ticker from an asset created this morning, and a window
-- that is legitimately empty would be re-requested every night forever.
--
-- `ingest_cursors` is kept for source-level scheduling (`last_run_at` ordering)
-- and user-facing status. Its `last_date` becomes a SUMMARY — the minimum
-- committed `last_date` across that source's refs — never the source of truth.

-- Like series_points and ingest_cursors, this is global market-data bookkeeping:
-- NO user_id and NO row-level security by design (CLAUDE.md non-negotiables).
-- Access control is by grant; only the service role (cron) writes.
create table public.ingest_watermarks (
  source_id          text not null,
  -- Mirrors SourceCapability in packs/types.ts. A closed set there, a check here.
  capability         text not null,
  -- Series id ('br.cdi') or asset identifier ('HGLG11', 'td:tesouro-selic:2029-03-01').
  ref                text not null,

  -- Earliest date this ref is currently wanted from, derived from the earliest
  -- relevant transaction. A newly created asset can pull this EARLIER than a
  -- previous run's target; the scheduler then restarts the forward cursor here
  -- and replays idempotently rather than leaving a hole before `last_date`.
  target_from        date not null,

  -- Highest date whose request AND validated write both succeeded. Advances
  -- through the requested `to` on a coverage-complete empty response, and never
  -- on an auth failure, abort, transport failure, or rejected output.
  last_date          date,

  -- The source's honest lower availability boundary: it confirmed it cannot
  -- serve anything before this date (a plan-truncated history, a bond that did
  -- not exist yet). Keeps the scheduler from both calling the missing span
  -- ingested and re-requesting it nightly. Cleared explicitly when credentials
  -- or plan coverage change.
  unavailable_before date,

  last_run_at        timestamptz,
  updated_at         timestamptz not null default now(),

  primary key (source_id, capability, ref),
  constraint ingest_watermarks_source_check
    check (source_id ~ '^([a-z]{2}|global)\.[a-z0-9_]+(\.[a-z0-9_]+)*$'),
  constraint ingest_watermarks_capability_check
    check (capability in ('spot', 'historical', 'series', 'fx')),
  constraint ingest_watermarks_ref_check check (btrim(ref) <> ''),
  -- A watermark may not claim to have committed data before it was ever wanted.
  constraint ingest_watermarks_last_date_check
    check (last_date is null or last_date >= target_from),
  -- An availability floor below the target tells us nothing and is a bug.
  constraint ingest_watermarks_unavailable_check
    check (unavailable_before is null or unavailable_before > target_from)
);

-- The scheduler loads a whole source's watermarks at once to plan its work.
create index ingest_watermarks_source_idx on public.ingest_watermarks (source_id);

create trigger ingest_watermarks_set_updated_at before update on public.ingest_watermarks
  for each row execute function public.set_updated_at();

comment on table public.ingest_watermarks is
  'Per-(source, capability, ref) ingestion resume markers. Global market-data bookkeeping: no user_id and no RLS by design; service-role writes only.';
comment on column public.ingest_cursors.last_date is
  'SUMMARY ONLY: the minimum committed last_date across this source''s ingest_watermarks. Not the resume source of truth.';

-- Same posture as series_points/ingest_cursors: PostgREST clients get nothing.
revoke all on public.ingest_watermarks from anon, authenticated;
