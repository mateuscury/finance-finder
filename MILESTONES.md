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

## 2. Financial kernel and recovery — complete (2026-09-20)

- `lib/calc/` is the pure financial kernel: decimal money, dates and
  calendars, FIFO positions, one function per series kind, FX resolution,
  one module per valuation strategy, the portfolio builder, TWR, MWR (XIRR),
  contribution, attribution and real returns — every module hand-tested and
  every property the plan names proven with `fast-check`.
- `packs/br` covers all six BR instrument kinds (two added: `br.cdb_prefixado`,
  `br.cdb_ipca`). Its golden portfolio is derived independently by
  `packs/br/fixtures/derive_expected.py` and reproduced by the kernel to
  `1e-8`; `pnpm test:packs` reports exactly 1 skip (`global`, no instruments).
- Backup v1 exports every price row with its provenance and restores
  all-or-nothing into an empty account through `export_backup()` /
  `restore_backup(jsonb)`; `lib/backup/roundtrip.dbtest.ts` proves
  export→delete→restore→export equivalence against a real Postgres and that
  the kernel reproduces the golden portfolio from the restored rows.
- `pnpm release:check` is red only on `app/login/page.tsx`, the two draft
  packs and `specs/PERSONAS.md` — exactly the plan's definition of done.

Implementation plan: `docs/milestone-2-plan.md` (Progress table and
per-phase Grounding notes).

### Contract corrections found while implementing

1. **The XIRR property "|NPV| < 1e-10" was ill-posed.** Property search
   produced streams with a 99.99% loss over four years, where the root sits
   within 1e-4 of −1 and |NPV′| exceeds 1e21: the rate was correct to thirty
   digits while the residual stayed at 1e-10 under 40- and 80-digit
   evaluation alike. Newton's stop was tightened to 1e-20 and bisection's
   bracket to 1e-30 (one extra quadratic step), and the property is now
   scale-free — NPV changes sign across `rate ± 1e-12`. Three found streams
   are pinned as regression cases.
2. **`[auth.email] enable_signup = false` had disabled email LOGIN, not just
   signups.** On the installed CLI (2.72) the key maps to
   `GOTRUE_EXTERNAL_EMAIL_ENABLED`, the whole email provider; signups were
   already refused by `[auth] enable_signup = false`. The first `signIn()`
   in the round-trip test failed with "Email logins are disabled" — and so
   would the Milestone 3 login screen. The provider is re-enabled with the
   reason in `supabase/config.toml`; the §0 claim "Local Auth disables
   signups" was true but incomplete.
3. **Supabase's default privileges grant `service_role` EXECUTE on every new
   function**, so `revoke … from public, anon` alone left the service role
   able to call both backup RPCs. Both revoke it by name, as
   `commit_ingest_chunk` already did; the dbtest proves it.
4. **The golden portfolio has four cash flows, not three.** Without a cash
   ledger an unfunded buy reads as an 8% one-day gain and a withdrawal the
   day after a sale as a spurious jump; a deposit on each purchase day and
   the sale's withdrawal is what a user without a cash ledger records and
   what decision 1 is written for.
5. **`percent_of_index` requires the convention's `dayCount` to equal the
   index series' own** (decision 13 as recorded). The prose had left the
   two free to disagree, which would have meant guessing which one governs.

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

### Decisions taken 2026-09-20 (grounding Phases 3–7 against the merged tree)

Found while writing the per-phase grounding notes in
`docs/milestone-2-plan.md`; confirmed by the maintainer when the plan was
approved for execution. None changes the BR golden numbers — every BR
accrual is `daily` and every BR asset is BRL — so all six are contract.

13. **Accrual support matrix.** `daily` is the only granularity that reads
    `dayCount`: plain and `index_plus_spread` use `yearFraction`;
    `percent_of_index` uses `compoundRate`, which already refuses `30/360`
    and `rate_annual` on `ACT/360`, and requires the convention's `dayCount`
    to equal the index series' own. `monthly` and `annual` are anniversary
    arithmetic over `completedMonths` and do not consult `dayCount`.
    `percent_of_index` with `monthly`/`annual`, or with a descriptor that is
    not `rate_daily`/`rate_annual`; and `index_plus_spread` with a
    descriptor that is not `inflation_index`/`index_level` — all throw
    `unsupported_convention`. The closed union is implemented whole, and
    every undefined cell is an explicit throw, not a silent guess.
14. **Accrual never reads `maturity`.** A lot accrues until a `sell` closes
    it. The ledger, not the metadata, says whether the money is still
    invested; a matured CDB with no recorded redemption is missing data,
    which the Maturities screen surfaces in Milestone 5. Freezing at
    maturity would hide that gap behind a plausible number. The kernel reads
    accrual metadata through its own `{ rate }` schema; a failure is
    `unpriced` with `invalid_metadata`, never a throw.
15. **Contribution and attribution convert with the FX series, never with
    `transactions.fx_rate`.** Each transaction's cash amount is converted
    with `resolveFx` at its trade date under the asset's window; the row's
    `fx_rate` stays display-only. A missing rate makes that asset's
    contribution `null` with `no_fx_series` and marks the total partial.
    One FX source for every number a screen shows.
16. **TWR and MWR take flows already in base currency.** `twr.ts` and
    `mwr.ts` receive `{ date, amount }`; the caller (the golden runner now,
    the snapshot route in Milestone 3) converts a non-base flow with the
    same resolver at the flow's date. Flows dated on or before the first
    valuation date are part of `V₀`; flows after the last valuation date are
    outside the window and reported, not silently dropped.
17. **Portfolio builder output.** `holdings` carries every asset with open
    lots whose price AND FX legs each have a value (`ok`, `carried_forward`
    or `stale`), with `status` the worse of the two legs and
    `carriedForward` true whenever the row was not built on fresh inputs;
    an asset with an `unpriced` leg has no row and appears only in
    `excluded` with the reason; `totalBase` sums `ok` + `carried_forward`;
    `excluded` also lists `stale` rows with their last-known base value. A
    fully sold asset produces nothing. This is exactly what
    `portfolio_snapshots` stores plus the two nullable date columns
    decision 6 schedules.
18. **Backup `settings` is `{ base_currency, enabled_packs, locale, theme }`.**
    `last_export_at` is not exported: it is stamped by the Milestone 3 server
    action on the restoring account's own first export, and carrying it
    would make the round-trip test compare a value restore cannot honestly
    reproduce. `assets.updated_at` IS exported and restored alongside
    `created_at`, so two exports of the same data stay byte-identical.

## 3. Authenticated ledger

- Implement cookie auth using verified `getUser()`, mandatory AAL2 challenges
  for enrolled owners, and uniform login failure behavior.
- Implement asset, transaction, cash-flow, manual-price, and dry-run CSV flows.
- Paginate every PostgREST collection beyond the configured 1,000-row cap;
  aggregate server-side where raw rows are unnecessary.
- Ship the snapshot cron route and the snapshot invariant (Milestone 2
  decision 6): snapshots are rebuilt from a marker and never left stale by a
  history-changing write.

Implementation plan: `docs/milestone-3-plan.md` (conventions, thirteen
decisions to confirm before code, phases 0–7 and merge order).

## 4. Second-pack canary

- Add the minimal UK pack required by `PACKS.md` §14.
- Prove transitive dependency resolution and curve/scalar storage across packs.

## 5. UX and production readiness

- Build the ten responsive screens, first-run card, actionable empty states,
  stale/unpriced states, privacy mode, and accessible loading/error behavior.
- Exercise realistic multi-year portfolios and document performance budgets.
- Mark a pack `supported` only after all conformance evidence passes.
- Run `pnpm release:check`; only a fully green result permits real data.

