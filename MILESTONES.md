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

