-- Milestone 4 Phase 1 read views (docs/milestone-4-plan.md D-11 and the
-- Overview's need; MILESTONES.md §4 decision 52: this milestone's migrations
-- are read views and function bodies only).
--
-- Both views are `security_invoker`: under the caller's own RLS a user sees
-- one row per date of their own snapshots and their own marker row; the
-- service role (the snapshot job) sees every user. Every numeric leaves as
-- TEXT — no money value passes through a JSON number.

-- ---------------------------------------------------------------------------
-- 1. snapshot_markers: the snapshot job's per-user marker in ONE row per user
--    (D-11). `listUsers` used to issue two limit(1) reads per user; a
--    thousand users would have been two thousand round trips per run.
--    `earliest_trade_date` is what the marker falls back to when a user has
--    no snapshots yet (SPEC §8).
-- ---------------------------------------------------------------------------
create or replace view public.snapshot_markers
  with (security_invoker = true) as
  select s.user_id,
         (select max(p.date) from public.portfolio_snapshots p where p.user_id = s.user_id) as last_snapshot_date,
         (select min(t.trade_date) from public.transactions t where t.user_id = s.user_id) as earliest_trade_date
  from public.user_settings s;

comment on view public.snapshot_markers is
  'Per user: max(portfolio_snapshots.date) and min(transactions.trade_date), under the caller''s RLS. The snapshot job''s marker.';

grant select on public.snapshot_markers to authenticated;

-- ---------------------------------------------------------------------------
-- 2. snapshot_totals: the confident total per (user, date) — the sum of
--    ok + carried_forward rows (MILESTONES.md §2 decision 10) — with the
--    counts a chart needs to draw the stale mark. Reading the per-asset rows
--    to sum them in the app would page through years × assets rows on
--    every Overview render.
-- ---------------------------------------------------------------------------
create or replace view public.snapshot_totals
  with (security_invoker = true) as
  select p.user_id,
         p.date,
         max(p.base_currency) as base_currency,
         coalesce(sum(p.market_value_base) filter (where p.status in ('ok', 'carried_forward')), 0)::text as total_base,
         count(*)::integer as rows,
         (count(*) filter (where p.status = 'stale'))::integer as stale_rows,
         (count(*) filter (where p.carried_forward))::integer as carried_rows
  from public.portfolio_snapshots p
  group by p.user_id, p.date;

comment on view public.snapshot_totals is
  'Per (user, date): the confident total (ok + carried_forward) as text, with row, stale and carried-forward counts. Caller''s RLS.';

grant select on public.snapshot_totals to authenticated;
