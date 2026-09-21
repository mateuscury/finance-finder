# lib/jobs — after-response work under the service role

With the two cron routes, the ONLY constructors of the service-role client
(lint enforces it). A server action may call a runner only with a scope it
derived through the user's own RLS client — the asset ids it just created,
its own user id — never a form value.

- **`index.ts`** — `ingestJob(scope, spentMs)`, `snapshotsJob(scope,
spentMs)`, `priceThenSnapshot(...)` (asset creation, Refresh),
  `remainingBudgetMs` (the route's 60 s less what the action spent), and
  `deleteUserJob` — the one deliberately user-triggered service-role write.
- **`snapshots.ts`** — `runSnapshots`, shaped like `runIngest`: per user,
  from `max(snapshot date) + 1` (else the earliest trade), over the union of
  the holdable packs' business days, one upsert per day of exactly
  `valuePortfolio(...).holdings` as decimal strings plus `price_date`,
  `fx_date` and `status`; a clean stop when the budget is spent. Summaries
  are counts and codes.
- **`snapshots-store.ts`** — the Supabase implementation over
  `lib/ledger/rows.ts` scoped by user id. `listUsers` is one paginated read
  of the `snapshot_markers` view (one row per user); `writeDay` upserts in
  chunks of 500 rows, so a crash between chunks leaves a partial day — the
  marker is `max(date)`, so the next run rebuilds that day whole, and the
  upsert is idempotent. Prices are read from the ledger's first trade less
  the lookback; series from the marker less the lookback.
- Invalidation is not here: the `invalidate_snapshots` triggers drop rows
  from a touched date forward on every history-changing write, and the
  next run rebuilds them.
