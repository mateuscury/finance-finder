# Finance Finder milestones

The order below is a safety boundary, not only a project plan. Normal CI may be
green during scaffold development. **Do not enter real portfolio data until
`pnpm release:check` passes.**

## 0. Safety baseline — complete

- Cron authentication fails closed for missing or weak secrets.
- Local Auth disables signups, enforces a stronger password, and permits TOTP.
- The initial migration enforces owner-matching asset references, read-only
  derived snapshots, manual-only client price mutation, and core value checks.
- Yield curves have a tenor dimension; rate-unit semantics are explicit.
- The owner bootstrap command and deterministic empty seed exist.
- Draft packs default to disabled and the release-readiness command is present.

## 1. Trusted ingestion — complete (2026-09-06)

- `lib/packs/` holds `http.ts`, `redact.ts`, `fixtures.ts`, `validate.ts`,
  `activate.ts`, `ingest.ts` and `store.ts`; budgets, retries, redaction, point
  validation and PostgREST pagination are implemented and tested.
- Every source stub is replaced. IPCA is a real index level from IBGE SIDRA.
- Success, empty, 5xx and 429 fixtures are recorded for all five adapters and
  replay entirely offline.
- Both packs remain `draft`. `pnpm test:packs` reports 3 skips, down from 13;
  none was bypassed.
- `PACK_API_VERSION` is 3: `ctx.signal` + `remainingMs()`, `ctx.log` removed,
  structured `RefCoverage` added, carrying an explicit `unavailableBefore`.
- Forward migrations only (the initial migration was already applied):
  `initial_schema_hardening`, `ingest_watermarks`, and the atomic
  `commit_ingest_chunk` RPC.

Implementation plan: `docs/milestone-1-plan.md`.

### Correctness fixes after the sign-off audit

1. **The applied initial migration had been edited in place**, in violation of
   its own header. The edit kept the same version, so any database that had
   applied the original would never receive the changes — including a PRIMARY
   KEY change on `series_points`. The file was restored to its committed
   contents and the whole delta now ships as
   `20260906110000_initial_schema_hardening.sql`, written idempotently. A
   `db reset` reproduces the intended schema byte for byte.
2. **A watermark restart was defeated by `greatest()`** in the commit RPC: the
   target moved earlier but the high-water mark did not follow it down, so the
   newly required history was declared ingested without being fetched. The
   conflict clause now lets `last_date` follow a restart down while still
   refusing to rewind on ordinary progress.
3. **An unreachable brapi backfill looped forever.** A window older than the
   free plan's three months returned no points and no span, which the scheduler
   correctly refused to advance — and then re-requested identically every run.
   `RefCoverage` now carries an explicit `unavailableBefore`, which brapi
   declares from the oldest bar actually served, and the scheduler persists it
   even when nothing came back.
4. **A point naming an unrequested ref could still advance the requested ref's
   watermark**, because only the offending ref was marked ambiguous and the
   scheduler checks ambiguity per requested ref. An unattributable point now
   taints every requested ref.
5. **`unpriced` returned every asset** and **`new_packs` priced holdings**
   instead of backfilling series only. Both scopes are now correct and tested,
   and an asset-id filter that was applied after `range()` — paginating the
   unfiltered set — was moved before it.
6. **The number-preserving JSON reader could fabricate a price.** Assigning a
   `__proto__` key replaced the object's prototype instead of creating an own
   property, so `{"__proto__":{"close":999999}}` made `close` read back as
   999999 from an object with no such key. Keys are now defined with
   `Object.defineProperty`, matching `JSON.parse`.

### Contract corrections found by live testing

Three upstream facts contradicted the plan as written and were verified against
the live services before implementing around them:

1. **PTAX has no bulletin filter to apply.** `CotacaoDolarPeriodo` returns
   `TipoCotacaoDolar`, which has no `tipoBoletim` property — the OData
   `$metadata` shows it on a separate entity used by the opening/intermediate
   function. Asking for it is an HTTP 400; the function is the closing series
   by construction.
2. **BCB SGS reports an empty window as HTTP 404**, not `200 []`. Treating that
   as an error would stall the CDI/SELIC watermark on every weekend run.
3. **brapi's free plan rejects history beyond 3 months** (HTTP 400) rather than
   truncating, and **silently ignores `start`/`end`** — returning recent data
   under an unrelated requested window. `br.ifix` and the `historical`
   capability were both kept, verified under the project's real free token.

### Decisions taken 2026-09-06 (planning session, before implementation)

Recorded here because each one changes a checked-in contract. Rationale in
full so the reasoning survives the people who made it.

1. **IPCA index level comes from IBGE SIDRA, not from chaining SGS 433.**
   SGS 433 is a monthly percentage change; turning it into a level is
   arithmetic, and packs never supply math (PACKS.md §1). Add a source
   `br.ibge_sidra` that fetches the número-índice directly (table 1737, base
   December 1993 = 100; verify ids against the SIDRA docs before recording
   fixtures) and point `br.ipca` at it. Fallback, only if SIDRA proves
   unusable: a kernel-side chain step, which is a series-kind change and a
   `PACK_API_VERSION` bump.
2. **Tesouro Direto is valued from the published PU (`nav_unit_price`); no
   fixed-tenor curve.** Tesouro publishes one rate and one unit price per bond
   per day, not per tenor, so building `br.td_curve` at fixed tenors would be
   interpolation inside a pack. The PU is the price Tesouro itself marks at
   and is what a broker statement shows. The rate locked at purchase is in the
   same CSV row ("Taxa Compra Manhã" on the purchase date) and may be stored
   as metadata for display, but it is never used for valuation: accruing at
   the contracted rate ("marcação na curva") is a different number from market
   value and, if ever wanted, is a kernel `accrual` feature for a later
   milestone. Consequence: drop `br.td_curve` from `packs/br/series.ts` and
   switch `br.tesouro_direto` in `packs/br/instruments.ts`; update the README.
3. **AwesomeAPI is removed from `packs/global` until a series needs it.** No
   series references `global.awesomeapi` (USD/BRL points at PTAX), so its
   adapter and four fixtures would be maintained for no consumer, and the
   release gate would still demand them. Removal is cheap to reverse: one
   file, one manifest entry, no schema, and `series_points` is keyed by
   series id, not source id. Bring it back with the series that justifies it.

## 2. Financial kernel and recovery

- Implement decimal money, positions, valuation, FX, TWR, MWR, contribution,
  attribution, and staleness behavior with property tests.
- Fill every golden portfolio and make the kernel reproduce it to `1e-8`.
- Implement complete JSON export and restore plus an automated
  export→delete→restore equivalence test.

Implementation plan: `docs/milestone-2-plan.md`.

### Decisions taken 2026-09-20 (before implementation)

Each item below changes a checked-in contract or the golden numbers in
`packs/br/fixtures/expected.json`. Recorded with rationale, as Milestone 1
did, so the reasoning survives the people who made it. Items marked
**numbers** must be applied when deriving `expected.json` by hand; the fixture
is never adjusted afterwards to match kernel output.

1. **Cash flows are start-of-day** (numbers). A flow dated `D` is in the
   portfolio before `D`'s valuation: `r = V_D / (V_{D−1} + CF_D) − 1`. This
   matches how a user without a cash ledger records a deposit — dated the day
   it is invested — and a same-day deposit-and-buy reports ≈0% rather than a
   spurious gain. It distorts only the path when cash idles, never the total.
   End-of-day is equally GIPS-acceptable; the point is that one convention is
   stated and the golden fixture is derived under it.
2. **A ledger with transactions but no cash flows skips and reports**
   (numbers). Zero-start sub-periods are skipped and listed in the result;
   TWR is defined from the first valuation with positive value; MWR is `null`
   with a stated reason when the flow stream has no negative amount. The
   alternative — inferring external flows from buy/sell transactions when
   `cash_flows` is empty — silently mixes two data models the moment the user
   records one real deposit. The Milestone 5 UI nudges for the missing deposit.
3. **Export carries every `prices` row, with `source_id` per row.** SPEC
   §12.3 listed only `manual_prices`, but brapi's free plan cannot backfill
   beyond three months (§1 contract 3): FII history lost from the database is
   lost for good, and a restore from a manual-only backup would rebuild a
   portfolio whose snapshots cannot be reproduced. `version` stays `1`
   because nothing has shipped; SPEC §12.3 is amended in the same merge unit.
4. **Restore only into an empty account; ids preserved; `user_id` rewritten;
   warn-but-restore on pack validation; all-or-nothing.** An account with any
   asset, transaction, cash flow or price refuses with a fixed reason — merge
   semantics are a different feature. Row ids are preserved because
   transactions and prices reference asset ids; `user_id` is always rewritten
   to the restoring user so a file can never write another user's rows;
   `created_at` is preserved for equivalence. Unknown `pack_id` /
   `instrument_kind`, or metadata failing the pack schema, warn and restore
   (the asset shows as unpriced): data preservation beats validation in a
   recovery path. The whole restore is one database transaction.
5. **Two new BR instrument kinds: `br.cdb_prefixado` (plain) and
   `br.cdb_ipca` (`index_plus_spread` on `br.ipca`).** `packs/br` expressed
   only `percent_of_index`, so two of the three kernel accrual modes had no
   real consumer in the golden portfolio. Both share `PrivateCreditMetadata`.
   Data-only pack change, cheap to reverse.
6. **The snapshot cron route ships in Milestone 3.** Milestone 2 ships the
   pure builder (`lib/calc/portfolio.ts` produces exactly the per-asset rows
   `portfolio_snapshots` stores). The route needs users with ledgers, and its
   other triggers (import commit, Refresh, first price) are Milestone 3
   surfaces. When it lands, `portfolio_snapshots` gains nullable `price_date`
   and `fx_date` (forward migration) so a stale row is self-describing.
7. **`curve_mark_to_market` with `indexation` is unsupported in Milestone 2.**
   No in-repo instrument uses the strategy since Tesouro moved to NAV
   (§1 decision 2). The nominal path is implemented and property-tested
   against a synthetic curve because closed unions are implemented whole; the
   inflation-linked path needs an index base date the PACKS §5 shape does not
   carry, and is scheduled with the Milestone 4 gilt canary so a real
   instrument drives the shape instead of a guess.
8. **Real-database tests are a separate `*.dbtest.ts` tier.** `pnpm test:db`
   runs them against the local Supabase stack and **fails loudly** when the
   stack or its environment variables are absent — never a skip. `pnpm test`
   excludes them so CI without Docker stays meaningful; `pnpm release:check`
   requires them. The tier also hosts the two Milestone 1 tests its plan
   demanded and the tree lacks: manual-price protection and
   `commit_ingest_chunk` rollback.
9. **`compounding` is the recognition granularity of an effective annual
   rate** (numbers). A "12% a.a." with `daily` accrues `(1.12)^(n/252) − 1`,
   which is how Brazilian CDB and Tesouro rates are quoted. The nominal
   reading — `(1 + r/252)^n` — would misprice every prefixado relative to its
   contracted rate.
10. **Confident totals exclude stale and unpriced holdings** (numbers) and
    report them alongside with their last-known values, rather than folding a
    last-known value into the total with a flag. This is SPEC §11 taken
    literally and is the number the snapshot builder writes.
11. **`restore_backup` is `security definer` and enforces ownership itself**
    (amendment, 2026-09-20, found while reviewing the plan against the
    schema). Decision 3 exports every `prices` row, but the insert policy
    from `initial_schema_hardening` admits only `source_id = 'manual'` from a
    client, so a `security invoker` restore would either fail wholesale or
    drop exactly the ingested history decision 3 preserves. The function
    therefore runs as definer with `search_path` pinned, execute revoked
    from `public`/`anon` and granted to `authenticated` only, and — because
    it is now the trust boundary — checks in its own body that the account
    is empty, that every transaction, cash flow and price references an
    asset **in the restored set**, and that every row's `user_id` is
    `auth.uid()`. The dbtest tier proves a file naming another user's asset
    id is refused. `export_backup` stays `security invoker`.
12. **The golden derivation is checked in** (amendment, 2026-09-20).
    `packs/br/fixtures/derive_expected.py` (Python standard library
    `decimal` only, no third-party imports) regenerates `expected.json` from
    `portfolio.json` and the conventions in the plan. Independence from the
    kernel is then auditable and re-runnable rather than a claim about a
    spreadsheet; a mismatch between the script and `lib/calc` is a bug in
    one of the two, resolved by rederiving by hand, never by editing the
    fixture to match.

## 3. Authenticated ledger

- Implement cookie auth using verified `getUser()`, mandatory AAL2 challenges
  for enrolled owners, and uniform login failure behavior.
- Implement asset, transaction, cash-flow, manual-price, and dry-run CSV flows.
- Paginate every PostgREST collection beyond the configured 1,000-row cap;
  aggregate server-side where raw rows are unnecessary.

## 4. Second-pack canary

- Add the minimal UK pack required by `PACKS.md` §14.
- Prove transitive dependency resolution and curve/scalar storage across packs.

## 5. UX and production readiness

- Build the ten responsive screens, first-run card, actionable empty states,
  stale/unpriced states, privacy mode, and accessible loading/error behavior.
- Exercise realistic multi-year portfolios and document performance budgets.
- Mark a pack `supported` only after all conformance evidence passes.
- Run `pnpm release:check`; only a fully green result permits real data.

