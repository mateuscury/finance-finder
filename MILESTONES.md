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

## 3. Authenticated ledger — complete (2026-09-20)

- Implement cookie auth using verified `getUser()`, mandatory AAL2 challenges
  for enrolled owners, and uniform login failure behavior.
- Implement asset, transaction, cash-flow, manual-price, and dry-run CSV flows.
- Paginate every PostgREST collection beyond the configured 1,000-row cap;
  aggregate server-side where raw rows are unnecessary.
- Ship the snapshot cron route and the snapshot invariant (Milestone 2
  decision 6): snapshots are rebuilt from a marker and never left stale by a
  history-changing write.

Implementation plan: `docs/milestone-3-plan.md` (conventions, phases 0–7
and merge order; every phase carries a Grounding note).

Delivered: cookie sessions through `@supabase/ssr` with a `proxy.ts` that
only redirects optimistically and a DAL that verifies with `getUser()` on
every page and action; login, TOTP challenge and password reset; text-cast
paginated readers that reproduce the golden portfolio through RLS; snapshot
invalidation as database triggers and a resumable snapshot job plus the
second cron route; validated asset, transaction, cash-flow and manual-price
flows; a dry-run, all-or-nothing CSV import; Settings with packs, base
currency, security and your data. `pnpm release:check` is red only on the
two draft packs and `specs/PERSONAS.md`.

### Contract corrections found while implementing

1. **No browser Supabase client is needed.** `mfa.enroll()` returns the QR,
   so enrolment is a server action rendered by one small client widget;
   the session cookie can therefore be `httpOnly` as SPEC §9.6 requires.
2. **Password reset needs `NEXT_PUBLIC_SITE_URL`, `app/auth/callback` and
   a redirect-URL glob in `supabase/config.toml`** — the link's origin
   must come from configuration (a Host header can be spoofed), and
   Supabase's one-time code needs a landing route that continues only to a
   same-origin path.
3. **A `ledger_reads` migration**: the latest price per asset is a
   `DISTINCT ON` PostgREST cannot express, so a `security_invoker` view
   serves it under the caller's RLS; SPEC §9.4's "unpriced — source:
   reason" needs SELECT on `ingest_cursors`. Every paginated read orders by
   its key before `.range()`; Milestone 1's store did not and now does.
4. **The snapshot job's series read has no end cap** — capped at today it
   disagreed with the golden runner on identical data — and decision 21's
   "enabled packs" means the holdable ones: `global`, a 7-day dependency,
   must not make every day a trading day.
5. **A transient `csv_imports` table** holds an upload between preview and
   commit so the commit re-runs the dry run on the same bytes; the
   preview hash is over parsed values, so creating an unresolved asset from
   the preview does not invalidate it.
6. **Export is a route handler** (a download needs `Content-Disposition`);
   restore acknowledges warnings by re-upload.
7. `runSnapshots` takes no `registry` (the store owns it); the
   after-response wrappers live in `lib/jobs/index.ts`;
   `changeBaseCurrency` landed with the ledger flows since AC-004.6 is
   US-004's; `assetsUnpriced` as a count waits for its only consumer, the
   Milestone 5 status strip.

### Decisions taken 2026-09-20 (before implementation)

Confirmed on the plan's recommendation; numbered on from Milestone 2's 18.
Each changes a checked-in contract, a schema, or a behaviour a screen will
depend on. Rationale in full in the plan's "Decisions to confirm" section.

19. **Milestone 3 pages are functional and unstyled.** Server-component
    pages with native forms and server actions; no design tokens; the MFA
    enrolment widget is the only client component. Milestone 5 applies
    SPEC §10 to all ten screens at once. A flow with no form is untestable
    end to end and unusable by a person.
20. **Snapshot invalidation is a database trigger.** `AFTER` row triggers on
    `transactions` and `prices`, and on `user_settings.base_currency`,
    delete the user's snapshots from the touched date forward. Every write
    path — including the nightly price cron and `restore_backup`, which
    this milestone does not write — is covered without remembering.
21. **The snapshot calendar is the union of the user's enabled packs'
    business days.** One row per asset per such day.
22. **`portfolio_snapshots` gains `price_date`, `fx_date` and `status`**
    (`ok | carried_forward | stale`; amends decision 6). A reader that
    forgets to re-derive staleness would show a stale value as confident.
23. **The CSV parser and writer are hand-written** (RFC 4180, property
    tested). The only new dependency is `@supabase/ssr` 0.12.7, with
    `@supabase/supabase-js` moved to 2.116.0.
24. **The CSV column mapping lives in `user_settings.csv_column_map jsonb`**
    and is not part of the backup.
25. **Cash flows are entered in the base currency only.** `cash_flows.
currency` stays for a multi-currency ledger later; the kernel already
    converts at the flow date.
26. **Base currency locks at the first transaction; the reset is one
    explicit action** (`confirmReset: true`), after which the decision 20
    trigger drops every snapshot and the next run rebuilds history.
27. **Asset identity is immutable once it has a transaction; an asset with
    transactions cannot be deleted** (`asset_has_transactions`). `name` and
    `metadata` stay editable.
28. **Draft packs may be enabled, with a banner.** `unmaintained` is
    refused. Both in-repo packs are draft until Milestone 5.
29. **After-response chains through `after()`:** enabling a pack runs
    `runIngest({ kind: "new_packs" })`; creating an asset runs
    `runIngest({ kind: "assets" })` then `runSnapshots({ kind: "users" })`;
    Refresh runs `unpriced` + snapshots. All under the service role in
    `lib/jobs`, with a scope derived through the user's RLS client.
30. **Server-action routes declare `maxDuration = 60`**; after-response
    jobs receive `ingestBudgetMs()` minus the time the action spent.
31. **No browser end-to-end runner this milestone.** Pure-module unit
    tests, the `dbtest` tier (RLS, triggers, RPCs, sign-in, AAL, TOTP with
    an RFC 6238 generator in the test) and `next build` are the proof.

## 4. Brazil to production (MVP)

Re-sequenced 2026-09-20 (decision 32 below): this was §5, and the UK canary
that `PACKS.md` §14 placed here is now §5.

- Build the ten responsive screens, first-run card, actionable empty states,
  stale/unpriced states, privacy mode, and accessible loading/error behavior
  — for Brazil, driven by the registry and the user's settings, with nothing
  in `app/` or `lib/` naming Brazil outside one instance-defaults module.
- Add `br.stock` (ações, ETFs, BDRs) so a Brazilian brokerage account is
  representable; the rest of the BR pack is already complete.
- Exercise a realistic multi-year portfolio and document performance budgets.
- Mark `packs/br` and `packs/global` `supported` only after all conformance
  evidence passes; fill `specs/PERSONAS.md`.
- Deploy to the maintainer's Vercel and Supabase accounts by a runbook; run
  `pnpm release:check`; only a fully green result permits real data.
- Leave the second country as a documented seam (`PACKS.md` §16) and an
  enforced neutrality test — no `packs/uk` code.
- Close the spec gaps the Phase 5 review found (`docs/milestone-4-gaps.md`):
  positions on Assets, Transactions filters, instance liveness, and the
  `oversell` and `pack_in_use` guards — plus the SPEC sections that never
  recorded what the tree had already decided.

- Pay the technical debt of Milestones 1–3 first (`docs/milestone-4-plan.md`
  "Technical debt inventory"): a CI that runs on a remote, a typed client,
  coverage thresholds, security headers, env validation, the deferred read
  and job fixes — before any screen is built.

Implementation plan: `docs/milestone-4-plan.md` (conventions, the debt
inventory, decisions 33–52, phases 0–9 and merge order). Execution runbook:
`docs/milestone-4-execution.md` (one unit per commit, in order, with the
gate and the done-when for each).

### Decisions taken 2026-09-20 (before implementation)

32. **Milestone 4 is "Brazil to production"; the UK canary moves to
    Milestone 5.** `PACKS.md` §14 argued a canary before polish would
    catch kernel-shape flaws cheaply; three milestones in, the kernel has
    been driven by a real pack, an independently derived golden fixture
    and the live read, write and snapshot paths under RLS. The larger risk
    now is polishing screens no one has used with a full ledger, and the
    maintainer's stated goal is a workable Brazilian MVP. §14's reason is
    preserved by two commitments in the plan: an enforced kernel-neutrality
    test, and a written checklist of every assumption the second pack will
    meet. Building that pack is not deferred indefinitely — it is the next
    milestone.

### Decisions taken 2026-09-20 (confirmed on the plan's recommendation)

Numbered on from 32. Each changes a checked-in contract, a dependency, a
doc that says _planned_, or a behaviour a screen will depend on. Rationale
in full in `docs/milestone-4-plan.md` "Decisions to confirm".

33. **`br.stock` joins `packs/br`** — ações, ETFs and BDRs on B3,
    `market_price` through `br.brapi`, `ticker` identifier, `{ name }`
    metadata; one catalog case, re-recorded fixtures, a README row with the
    BDR zero-FX-attribution note (SPEC §11), one golden row derived by the
    script. Poupança and fundos stay out (new source, licence review).
34. **UI copy ships in English and Brazilian Portuguese from the start**
    (the maintainer amended the plan's "English only"). `user_settings.
locale` selects copy and formatting; `lib/copy/{en,pt-BR}.ts` share one
    `Copy` type so the two dictionaries cannot drift; `lib/copy/index.ts`
    is the second allowed site for a locale literal; the instance default
    applies before sign-in. PACKS §15's translation question is closed: a
    pack's `locale` is formatting only, languages are kernel dictionaries.
35. **Charts are Recharts**, exact-pinned, the only new production
    dependency. A decimal string becomes a `number` only inside
    `app/(app)/_charts/**`, for a coordinate; lint exempts that directory
    and nothing else; the neutrality test still scans it.
36. **Time series come from `portfolio_snapshots`; period figures are
    computed by the kernel at request time.** No new tables, no cached
    returns.
37. **`lib/calc/benchmark.ts` `seriesReturn(descriptor, market, from, to)`**
    over the closed `SeriesKind` union, returning `Observed<KDecimal>`, with
    the two properties named in the plan.
38. **Maturities read an optional metadata convention:** a kind whose
    `metadataSchema` has `maturity: IsoDate` is a fixed-income holding.
    Contracted value at maturity is shown for plain-rate accrual kinds
    only; indexed kinds say the final amount depends on the index.
39. **A review gate after Phase 2** (tokens, type, theme, shell, Overview)
    before the other screens are built.
40. **Privacy mode is client-only** (`localStorage`, `<Amount>`, `•••`) —
    confirmed on the condition that the real boundaries stand and are
    exercised by a Phase 7 journey: RLS, verified cookie sessions, AAL2 for
    enrolled owners, the service role confined to cron and jobs, value-free
    logs, decision 51's headers. It is a convenience inside them.
41. **`packs/br` and `packs/global` become `supported` in Phase 8**, once
    fixtures are re-recorded within 90 days and conformance is fully green.
42. **A kernel-neutrality test** scans `app/` and `lib/` source for pack
    ids, currency codes and locale literals and allows them only in
    `lib/settings/defaults.ts` (and locale literals in `lib/copy/index.ts`,
    decision 34).
43. **Deployment is Vercel Hobby + Supabase free tier** on the maintainer's
    accounts, by `docs/DEPLOY.md`, performed with the maintainer.
44. **Performance budgets are measured** on a synthetic five-year,
    twenty-asset ledger: `runSnapshots` ≥ 50 days/s, every screen read
    < 500 ms p50 on the local stack; recorded in `docs/performance-budgets.
md`; optimisation only where a budget fails.
45. **The multi-country placeholder is PACKS §16 + decision 42 + the
    registry-driven form** — no stub pack, no kernel type change.
46. **Playwright smoke journeys** (`pnpm test:e2e`, a tier like `dbtest`,
    required by `release:check`): eight journeys plus the decision 40
    security-boundary journey.
47. **Styling is plain CSS on the SPEC §10 tokens with CSS Modules; no
    Tailwind, no shadcn/ui.** ARCHITECTURE §3's _planned_ row is reversed.
48. **Forms stay native `<form action>` with server actions; react-hook-form
    is not adopted.** ARCHITECTURE §3 amended.
49. **A typed Supabase client** from `pnpm db:types`: `lib/database.types.
ts` committed and diff-checked in CI; `SupabaseClient<Database>` in
    every factory.
50. **Prettier is the formatter; CI also runs `test:db`, `pnpm audit
--audit-level=high` and coverage thresholds.** React Testing Library is
    not adopted (pure view models + the journeys).
51. **Security headers with a nonce-based CSP** set by `proxy.ts`; HSTS in
    production; `frame-ancestors 'none'`; `Referrer-Policy: no-referrer`.
52. **Forward migrations this milestone are read views and function bodies
    only; no new user-data tables.**

### Decisions taken 2026-09-21 (grounding Phases 3–4)

53. **A stale date is not a valuation point.** Excluded from the TWR
    chain and the cumulative line, listed and drawn as a gap with the
    mark: its confident total omits a holding and would read as a move
    that never happened (decision 10 applied to time series).
54. **A cash flow in another currency is converted with `toBase` at its
    date, never thrown**; unconvertible → dropped, counted, the figure
    marked partial. Unreachable from the forms (decision 25); reachable
    from a restored file.

### Decision taken 2026-09-21 (grounding Phase 5)

55. **One client form; actions return on failure and redirect on
    success.** The asset form (pack → kind → generated metadata fields)
    is the one Client Component form, on `useActionState`; every other
    ledger form stays server-rendered with the redirect-to-`<Notice>`
    pattern plus `aria-invalid` on the fields the query names. Decision 48
    applied: no form library, client state only where the form cannot be
    drawn without it; zod schemas never reach the client.

### Decisions taken 2026-09-23 (spec gaps found by the Phase 5 review)

The Phase 5 review read the tree against `SPEC.md` and found two kinds of
gap: decisions the code had to make because the SPEC never made them, and
product holes the SPEC never contemplated. Plan and runbook:
`docs/milestone-4-gaps.md`, units G-U1…G-U6 between Phases 5 and 6.

56. **The analysis period vocabulary is `1m · ytd · 1y · all`.** Each
    period's nominal start resolves to the latest snapshot date at or
    before it; the default is `all` under a year of history and `1y`
    after; a period with no snapshot at or before its start is not
    offered. Built in Phase 3 (`app/(app)/_models/period.ts`, US-010
    AC-010.1) and never written down in the document that owns features.
57. **Top movers are the five largest absolute base-currency changes
    between the last two snapshot dates, confident rows only.** A stale
    row on either date drops the asset. Built in Phase 2
    (`app/(app)/_models/overview.ts`); SPEC §9 screen 1 said only "top
    movers".
58. **Positions are FIFO lots; a sell beyond the open position is refused
    at write, never absorbed.** The kernel has thrown `oversell` since
    Milestone 2, but nothing outside it handled the throw: the schema
    checks the quantity's sign only, so a too-large sell was written, and
    from then on every screen that values the ledger fell to the generic
    error boundary while the nightly snapshot job marked the user
    `error`. Now the form, the edit and the import preview check
    `quantityAt` before writing. A ledger that still holds one — only a
    restored backup can, since `restore_backup` is a database transaction
    and cannot run the kernel — is shown with the asset marked, not
    computed.
59. **Cost is trade cost before fees.** `openCost = Σ quantity ×
unitPrice` over the open lots, `averageCost = openCost / quantity`,
    `unrealised = market value native − open cost`, all labelled _before
    fees_ on screen. A fee-capitalised average is Brazil's fiscal "preço
    médio", the one number ARCHITECTURE §2 keeps out; the `Lot` has no fee
    leg, and allocating fees across a partially consumed lot would be a
    kernel decision the golden fixture does not exercise. Fees stay in the
    figures that are about money in and out — `investedFlows`, MWR,
    Contribution.
60. **Assets is the positions screen.** No eleventh route: the list gains
    quantity, average cost, value in base and unrealised; the asset page
    gains its open lots. "Ten screens" stays true in all five documents
    that say it, the nav keeps the two groups of SPEC §9.2, and the §9.5
    empty copy ("Add what you hold") finally describes the screen it is
    on.
61. **A pack with held assets cannot be disabled** — `setEnabledPacks`
    refuses with `pack_in_use`. `readLedger` activates the packs of held
    assets whatever the setting says, so the holdings would keep being
    priced and valued while Settings claimed the pack was off. The
    refusal makes the setting mean what it says.
62. **Refresh is debounced server-side on its own cookie; overlapping
    runs are safe by idempotence; no lease.** The cookie existed from
    P2-U4 but only the strip read it, so ten clicks scheduled ten job
    chains. A lease was rejected: a lease row is new user data (decision
    52 forbids), a Postgres advisory lock cannot span PostgREST's
    per-request transactions, and a lease outliving a crashed run would
    block the nightly cron — the failure it was meant to prevent, made
    permanent.
63. **Liveness is derived from the data, never logged.** Two missed
    nightly price runs, a source with `last_error`, or a snapshot gap
    nothing has written into for two trading days each raise a strip item
    linking to Settings → Instance. D-19 chose `console.log` over a runs
    table; with no error-reporting SaaS by design (SPEC §12) the app is
    the only channel the owner has, and a self-hosted cron that dies
    quietly is the failure most likely to rot an instance while its
    carried-forward prices still look like numbers.
64. **Transactions filters by asset, type and date range**, applied by
    the database before paging; the pager preserves them; an invalid
    value is ignored field by field, because a filter is navigation, not
    input; the filtered count is shown. SPEC §9.1's own premise is a user
    arriving with years of history, and the list had a pager and nothing
    else. `?asset=` — the link Maturities already uses to record a sell —
    now both filters the list and preselects the form, so the sell is
    entered while that asset's own history is on screen.
65. **Nothing is pruned in v1; growth is visible.** SPEC §8 states the
    arithmetic (per pack ≈ series × 252 rows a year; per user ≈ assets ×
    252 prices and as many snapshot rows) and Settings → Instance shows
    the live counts, own tables exact and `series_points` estimated.
66. **The root `SPEC.md` carries the accessibility floor (§10) and the
    performance budgets (§8); `specs/SPEC.md` never holds a decision the
    root lacks.** The acceptance criteria that drove Phases 2–5 were
    written in `specs/` while the document that wins on features stayed
    silent. `CLAUDE.md`'s precedence table now says so.

### Contract corrections found while implementing

1. **Decision 53 needed the unpriced case too.** A holding that goes
   `unpriced` leaves NO snapshot row, so "a date with any stale row" missed
   the golden's own history: once its CDI series ends, the % CDI accruals
   vanish from the confident total and the chain read a −30 % move that
   never happened. A date is now a valuation point only when every asset
   with open lots on it has a confident row (`coverTotals`: `staleRows ===
0 && rows ≥ openHoldings`); the screen states the span the figures
   cover and how many days were left out.
2. **XIRR over a single-date stream returned the bracket's first grid point
   as a rate.** Every flow on one date makes the NPV a constant; a zero
   constant made `bisection` return −0.999999 as "the" root. Found while
   testing `runGolden` on a one-date fixture (Phase 1, coverage work).
   `xirr` now returns `insufficient_flows` when every flow shares a date;
   documented in `lib/calc/mwr.ts` and the README.
3. **Decision 34 needed a server-side edge.** `updatePreferences` accepted
   any well-formed BCP-47 tag, so a hand-made request could store a locale
   no dictionary exists for and the app would silently fall back to
   English. It now refuses anything outside `LOCALES` (through
   `isSupportedLocale`, never a literal); the Settings select lists exactly
   those, each language named in its own words from its own dictionary.
4. **Strings that reach a Client Component are props.** The TOTP widget's
   copy group had a function leaf; a Server Component cannot pass one
   across the boundary. That group holds strings only, and the per-reason
   lines it shows come from `copy.security`, which already were.

### Advisories recorded

- **P1-U8, coverage floors.** `lib/calc` branches measured 93.6 % against
  the 95 % target after the Phase 1 tests; the floor is 92. The uncovered
  branches are contract-violation throws and null legs in `golden.ts`,
  `contribution.ts`, `fx.ts` and `mwr.ts`. Every other module group is
  above 85 % branches and 90 % on the other metrics. Vitest's `autoUpdate`
  was tried and rejected: it ratchets to a high-water mark that the
  property tests' random exploration does not reproduce, a flake by
  construction. Floors are raised by hand.
- **P1-U8, property timeout under coverage.** `mwr.test.ts` "deposit D and
  terminal V … within 1e-12" — a hundred 40-digit Newton/bisection solves —
  exceeded vitest's 5 s default in two of nine coverage runs (5.24 s
  observed) with 61 workers contending; never a counterexample. It now
  carries the 60 s budget its sibling property already had.
- **P5-U2, `html, body { overflow-x: hidden }` hides overflow from the
  test too.** A too-wide table cell was clipped rather than scrolled, so
  `scrollWidth <= clientWidth` passed while a link was cut off at 400 px.
  `e2e/helpers.ts expectNoHorizontalOverflow` now measures element boxes,
  skipping `.table-scroll` and visually hidden ancestors. Found by looking
  at the screenshot's width, not by the assertion.
- **P5-U2, a `<form>` inside a `<p>`.** The import page's file line nested
  the discard form in a paragraph — invalid HTML, a hydration error in
  the console, visible only in the dev server's log during e2e. Now a
  `<div>`. The e2e run's server log is worth reading each time.
- **P5-U3, `0` versus `-0`.** `lib/util/order.test.ts` asserted
  antisymmetry as `expect(sign(xy)).toBe(-sign(yx))`; when fast-check
  drew two equal rows both signs were zero and `Object.is(0, -0)` is
  false. A latent flake since Phase 1 (one failure in roughly thirty
  coverage runs). The property now asserts `xy + yx === 0`.
- **P5, pack metadata labels are English in both languages.** Field labels
  on the asset form are the pack schema's keys humanised (P5-U1 by
  design: packs own their field names). A Portuguese label for "maturity"
  or "issuer" would be a pack-supplied mapping — a `PACK_API_VERSION`
  question for the UK canary, not a kernel string. Left as is; noted in
  the plan's debt inventory.

## 5. Second-pack canary (UK)

- Add the minimal UK pack required by `PACKS.md` §14 — one instrument kind
  (a gilt on `curve_mark_to_market`), one series (SONIA), one source.
- Prove transitive dependency resolution, a second FX series, yield-curve
  storage with `tenor_days > 0`, and a two-currency portfolio against a
  second independently derived golden fixture.
- Resolve what Milestones 2–4 deferred to it: foreign-currency cash flows
  (decision 25), `curve_mark_to_market` with `indexation` (decision 7),
  rate series on a day count other than `BUS/252`, and every item in
  `PACKS.md` §16.
