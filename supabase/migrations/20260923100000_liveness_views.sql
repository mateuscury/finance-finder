-- Liveness (SPEC §8, §9.2, §12.3; MILESTONES.md §4 decision 63).
--
-- A self-hosted instance has no error-reporting SaaS by design (SPEC §12), so
-- the app itself is the only channel that can tell its owner the crons stopped.
-- The strip needs one fact the marker view did not carry: not just how far
-- history is built, but WHEN that was last written. A gap that is still
-- closing is a rebuild; a gap nothing has written into for two trading days is
-- a stall, and says so.
--
-- Decision 52: this milestone's migrations are read views and function bodies.
-- No new table, no new column on a user table — `created_at` on
-- `portfolio_snapshots` has carried this since the initial schema; nothing
-- read it.

create or replace view public.snapshot_markers
  with (security_invoker = true) as
  select s.user_id,
         (select max(p.date) from public.portfolio_snapshots p where p.user_id = s.user_id) as last_snapshot_date,
         (select min(t.trade_date) from public.transactions t where t.user_id = s.user_id) as earliest_trade_date,
         (select max(p.created_at) from public.portfolio_snapshots p where p.user_id = s.user_id)
           as last_snapshot_written_at
  from public.user_settings s;

comment on view public.snapshot_markers is
  'Per user: max(portfolio_snapshots.date), min(transactions.trade_date) and max(portfolio_snapshots.created_at), under the caller''s RLS. The snapshot job''s marker, plus when it last wrote (decision 63).';

grant select on public.snapshot_markers to authenticated;
