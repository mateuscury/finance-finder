-- Ledger read helpers (docs/milestone-3-plan.md "Reads"; SPEC §9.4).
--
-- 1. The latest price per asset is a DISTINCT ON, which PostgREST cannot
--    express; reading every price row to reduce in the app would be exactly
--    the row dump the plan forbids. A view WITH (security_invoker = true)
--    runs under the caller's RLS, so a user still sees only prices of their
--    own assets. `price` leaves as text — no numeric through a JSON number.
create or replace view public.asset_latest_prices
  with (security_invoker = true) as
  select distinct on (p.asset_id)
         p.asset_id,
         p.date,
         p.price::text as price,
         p.currency,
         p.source_id
  from public.prices p
  order by p.asset_id, p.date desc;

comment on view public.asset_latest_prices is
  'Latest price row per asset, under the caller''s RLS (security_invoker). price is text.';

grant select on public.asset_latest_prices to authenticated;

-- 2. SPEC §9.4: an unpriced asset shows the source's `ingest_cursors.last_error`
--    ("missing_env:BRAPI_TOKEN", a status code) — a per-source, value-free
--    string by Milestone 1's redaction rules. Reading it needs SELECT, which
--    the initial migration revoked along with writes. Writes stay revoked.
grant select on public.ingest_cursors to authenticated;
