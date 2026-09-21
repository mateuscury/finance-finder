# lib/ledger — the ledger behind RLS

Every function takes the user's own client (`requireUser().client`); the
database scopes reads and writes, and the composite `(asset_id, user_id)`
keys refuse anything a check missed.

- **`rows.ts`** — the ONE place the ledger is read for the kernel: every
  numeric column leaves PostgREST as `::text`, every collection is paginated
  and ordered by its key, and `readLedger` + `toPortfolioInput` hand
  `lib/calc` its input. `resolveAssets` keeps unknown instrument kinds aside
  as unpriced. `readSettings` defaults when the account has no row yet.
- **`queries.ts`** — list and count reads for the pages: `listAssets` with
  the latest price (a `security_invoker` view) and the source's
  `last_error`, paged transactions and cash flows, `countLedger`.
- **`schemas.ts`** — zod at the action boundary, in decimal strings,
  mirroring the database checks so a bad row is refused with a field name.
- **`result.ts`** — `ActionResult` with a closed `ActionReason` set;
  `reasonFor` maps Postgres codes and never reads a message.
- **`assets.ts`, `transactions.ts`, `cashFlows.ts`, `prices.ts`,
  `settings.ts`** — the writes. Identity locks once an asset has a
  transaction and a traded asset cannot be deleted (decision 27); cash flows
  are base currency only (25); manual prices are the one provenance a client
  may write; the base currency locks at the first transaction (26); packs
  are chosen from the registry (28).
- CSV lives in `lib/csv` (RFC 4180 reader/writer) and `lib/import` (column
  map, dry run, commit planner); backups in `lib/backup`.

`lib/testing/fake-client.ts` is a test-only PostgREST builder so every reason code is
unit-tested; `*.dbtest.ts` prove RLS, identity, locks and provenance live.
