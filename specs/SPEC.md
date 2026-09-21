# Finance Finder Specification

> ⚠️ **This is the source of truth for user stories and acceptance criteria.**
> The technical spec is the root `SPEC.md`; the architecture is `PACKS.md` and
> `ARCHITECTURE.md`; the build order is `MILESTONES.md`. Every story here cites
> the design document that owns its behaviour, and the QA gates in
> `.claude/CLAUDE.md` check implementations against the acceptance criteria
> below.
> Last updated: 2026-09-20 (Milestone 3 stories)

## Product Vision

A single-user, self-hosted dashboard over a personal investment portfolio
spanning multiple asset classes and currencies (ARCHITECTURE §1). It answers
four questions: what the portfolio is worth right now in the user's base
currency; how its performance compares against benchmarks; which asset — and,
for foreign holdings, which part of the exchange rate — contributed how much;
and when fixed-income holdings mature. The first market is Brazil (`packs/br`);
every other market is a pack that supplies data and mappings but never math
(PACKS.md §1). The product is private by posture (ARCHITECTURE §4.9), keeps
no analytics, and never computes a tax or fiscal figure (ARCHITECTURE §2).

Stories are added per milestone as that milestone is planned. Milestones 0–1
(safety baseline, trusted ingestion) were delivered before this file was
filled; their evidence is `MILESTONES.md` §0–§1 and the recorded fixtures.
Milestone 3 (ledger, login) and Milestone 5 (screens) stories arrive with
their plans; `PERSONAS.md` is filled with Milestone 5, the first
user-facing one.

## User Stories

### US-001: The kernel reproduces a hand-derived golden portfolio

**As a** the owner (the single self-hosting investor; formal persona in
`PERSONAS.md` from Milestone 5)
**I want** every valuation, TWR, MWR and contribution figure the app shows to
be computed by a pure kernel that reproduces an independently derived golden
portfolio to `1e-8`
**So that** I can trust a number on screen without re-deriving it myself, and
a contributor adding a market pack has an objective gate that proves their
mappings valued correctly (PACKS.md §11.5)

**Acceptance Criteria** (`docs/milestone-2-plan.md` "Definition of done";
conventions in its "Why the conventions below are written down first"
section; decisions in `MILESTONES.md` §2):
- [x] AC-001.1: `lib/calc/` contains `decimal.ts`, `money.ts`, `types.ts`,
      `dates.ts`, `calendar.ts`, `positions.ts`, `fx.ts`, `staleness.ts`,
      `series/` (one module per closed `SeriesKind`), `valuation/` (one
      module per closed `ValuationStrategy`), `portfolio.ts`, `twr.ts`,
      `mwr.ts`, `contribution.ts`, `attribution.ts`, `real.ts`, `golden.ts`,
      `errors.ts`, `index.ts`. `scripts/check-release-readiness.ts` no longer
      lists a missing kernel file.
- [x] AC-001.2: All kernel arithmetic uses the kernel-private `Decimal` clone
      (precision 40, `ROUND_HALF_EVEN`); values enter as decimal strings
      matching `DecimalStringSchema` and leave as canonical decimal strings.
      `pnpm lint` fails on any `@supabase/*`, `next/*`, `@/lib/packs`,
      `@/lib/supabase`, specific-pack import, `parseFloat`, `Number(` or
      `Math.*` inside `lib/calc/` source.
- [x] AC-001.3: Every module has unit tests; every property named in the plan
      (Phases 1–4) has a `fast-check` property test. `pnpm test:calc` runs
      without `--passWithNoTests`.
- [x] AC-001.4: Valuation returns a discriminated result — `ok`,
      `carried_forward`, `stale` (with last known value and date) or
      `unpriced` (with a fixed reason code) — never `NaN`, never a number
      built on missing data. Confident totals exclude stale and unpriced
      holdings and list them alongside (decision 10; root SPEC §11).
- [x] AC-001.5: TWR uses start-of-day cash flows (decision 1); zero-start
      sub-periods are skipped and reported and MWR is `null` with a reason
      when the flow stream has no negative amount (decision 2); accrual
      `compounding` is the recognition granularity of an effective annual
      rate (decision 9).
- [x] AC-001.6: `packs/br/fixtures/portfolio.json` covers every BR instrument
      kind including `br.cdb_prefixado` and `br.cdb_ipca` (decision 5), and
      `expected.json` states valuation, TWR, MWR and contribution with a
      `$derivation` block of intermediate factors computed OUTSIDE the
      kernel. `expected.json` is never edited to match kernel output.
- [x] AC-001.7: `packs/conformance/fixtures.test.ts` contains no
      `expect.fail`; the kernel-reproduction test runs for every pack with
      instruments and matches to an absolute tolerance of `1e-8`.
      `pnpm test:packs` reports exactly 1 skip (the instrument-less `global`
      pack).
- [x] AC-001.8: `curve_mark_to_market` with `indexation` returns `unpriced`
      with reason `indexation_not_supported` (decision 7); the nominal path
      is property-tested against a synthetic curve.

**Test Scenarios**:
```
Given: packs/br/fixtures/portfolio.json (six instrument kinds, nine
       transactions incl. one sell and one dividend, four cash flows — a
       deposit on each purchase day and the sale's withdrawal — six
       valuation dates spanning Carnival 2026, one FII price missing on one
       valuation date)
When:  runGolden(fixture, registry) is executed by the conformance suite
Then:  every figure in expected.json matches to 1e-8, the missing FII price is
       reported as carried_forward, and no value in the output is a JS number

Given: a holding whose last price is older than the pack's staleness window
When:  valuePortfolio(input, asOf) is executed
Then:  the holding is `stale` with its last known value and date, it is absent
       from totalBase, and it appears in the excluded list

Given: a ledger with buys and sells but an empty cash_flows table
When:  twr() and mwr() are executed
Then:  twr is defined from the first positive valuation with the skipped
       sub-periods listed; mwr is null with reason insufficient_flows
```

**Priority**: Must Have
**Status**: Done (2026-09-20)

---

### US-002: A backup restores to an equivalent portfolio

**As a** the owner
**I want** a complete JSON export of my ledger that restores into an empty
account and is proven equivalent by an automated test against a real database
**So that** losing the database, the host or the Supabase project is a
recoverable event and not the end of my portfolio history (root SPEC §12.3)

**Acceptance Criteria** (`docs/milestone-2-plan.md` Phase 6; decisions 3, 4
and 8 in `MILESTONES.md` §2):
- [x] AC-002.1: `lib/backup/` holds a versioned zod `BackupSchema` (v1:
      `version`, `exported_at`, `settings`, `assets`, `transactions`,
      `cash_flows`, `prices`), a deterministic serializer (stable row order,
      fixed key order, canonical decimals — two exports of the same data are
      byte-identical except `exported_at`), a parser that rejects unknown
      versions with a fixed reason, and a pure restore planner.
- [x] AC-002.2: The export carries EVERY `prices` row with its `source_id`,
      not only manual ones (decision 3). It never carries `series_points` or
      `portfolio_snapshots`.
- [x] AC-002.3: Restore refuses a non-empty account (any asset, transaction,
      cash flow or price) with a fixed reason; preserves row ids and
      `created_at`; always rewrites `user_id` to the restoring user; warns
      but restores on unknown `pack_id` / `instrument_kind` or metadata that
      fails the pack schema; and is all-or-nothing in one database
      transaction (decision 4).
- [x] AC-002.4: Forward migrations add `export_backup()` and
      `restore_backup(jsonb)` with an explicit `search_path`, execute revoked
      from `public`/`anon` and granted to `authenticated`; every `numeric` is
      cast to text on the way out and back on the way in, so no value passes
      through a float. Neither touches `series_points`, `ingest_*` or
      `portfolio_snapshots`.
- [x] AC-002.5: The restore path enforces ownership itself: a file cannot
      write a transaction or price against an asset id outside the restored
      set, and cannot write rows for another user.
- [x] AC-002.6: `lib/backup/roundtrip.dbtest.ts` seeds the golden portfolio
      for a throwaway user, exports, deletes the auth user and verifies
      cascades emptied every user table, recreates the user, restores,
      exports again, and asserts deep equality modulo `exported_at`; then
      runs `valuePortfolio` over the restored rows and matches
      `expected.json`.
- [x] AC-002.7: A `fast-check` property proves `parseBackup(serialize(x))`
      deep-equals the canonical form of `x` (sorted rows, canonical
      decimals) over generated ledgers.
- [x] AC-002.8: Root `SPEC.md` §12.3 no longer contains the "Release blocker"
      paragraph; it describes the restore path and its test.
      `scripts/check-release-readiness.ts` requires `lib/backup/` and the
      round-trip `dbtest` instead of grepping that sentence.
- [x] AC-002.9: `pnpm test:db` runs every `*.dbtest.ts` against the local
      Supabase stack and fails — never skips — when the stack or its
      environment variables are absent (decision 8). `pnpm test` excludes
      the tier; `pnpm release:check` requires it.

**Test Scenarios**:
```
Given: a throwaway user holding the golden portfolio
When:  export_backup → delete user → recreate user → restore_backup → export_backup
Then:  the two exports are deep-equal except exported_at, and the kernel
       valuation over the restored rows equals expected.json

Given: an account that already holds one asset
When:  restore_backup is called with any file
Then:  it refuses with the fixed reason and writes nothing

Given: a backup whose prices include rows with source_id = 'br.brapi'
When:  restore_backup is called by an authenticated user into an empty account
Then:  every price row is restored with its original source_id

Given: a backup file naming an asset id that belongs to another user
When:  restore_backup is called
Then:  it refuses and writes nothing
```

**Priority**: Must Have
**Status**: Done (2026-09-20)

---

### US-003: Sign in as the owner

**As a** the owner
**I want** to sign in with my email and password, be challenged for my TOTP
code whenever I have enrolled one, and sign out of this device or of every
device
**So that** my portfolio is reachable only by me, and a mailbox or a stolen
password alone is not enough to open it (root SPEC §9.6)

**Acceptance Criteria** (`docs/milestone-3-plan.md` "Identity and sessions";
decisions 19, 31):
- [x] AC-003.1: Sessions are cookie-based through `@supabase/ssr`
      (`lib/supabase/server.ts`, `httpOnly`, `Secure` outside development,
      `SameSite=Lax`). `proxy.ts` refreshes the session on every matched
      request and redirects an unauthenticated request for a data route to
      `/login`, optimistically; it never decides authorization.
- [x] AC-003.2: `lib/auth/session.ts` `requireUser()` establishes identity
      with `getUser()` — never `getSession()`, which `pnpm lint` bans
      project-wide — and is called first by every page under `app/(app)/`
      and every server action.
- [x] AC-003.3: `app/login/page.tsx` is email + password, has no signup
      link, and one line says the account is created with
      `pnpm bootstrap:user`. A wrong password, an unknown email and a
      disabled account produce one identical result ("email or password
      incorrect"); the action never branches on the error kind.
- [x] AC-003.4: When the user has a verified TOTP factor, an AAL1 session
      is redirected to `/login/mfa` by `requireUser()` before any data
      page or action runs; a correct code raises the session to AAL2.
      Unenrolled users stay at AAL1 with no challenge.
- [x] AC-003.5: Sign out (`scope: "local"`) is in the nav; "sign out
      everywhere" (`scope: "global"`) is in Settings.
- [x] AC-003.6: Password change is in Settings and requires an AAL2
      session when a factor is enrolled; password reset goes through
      Supabase's reset email with a fixed "if that address has an account,
      an email was sent" message and completes on `/login/reset`.
- [x] AC-003.7: `lib/auth/auth.dbtest.ts` proves against the local stack:
      sign-in succeeds; wrong password and unknown email return
      byte-identical results; enrolling a TOTP factor and verifying a code
      from an RFC 6238 generator written in the test raises
      `getAuthenticatorAssuranceLevel()` to `aal2`.

**Test Scenarios**:
```
Given: the owner has no TOTP factor
When:  they sign in with the right password
Then:  they land on / and requireUser() returns their id

Given: the owner has a verified TOTP factor
When:  they sign in with the right password and open /assets
Then:  they are redirected to /login/mfa; after a valid code /assets renders

Given: an unknown email or a wrong password
When:  the login action runs
Then:  the response body and status are identical in both cases
```

**Priority**: Must Have
**Status**: Done (2026-09-20)

---

### US-004: Keep the ledger

**As a** the owner
**I want** to create, edit and delete my assets, transactions and cash
flows through validated forms, with mistakes rejected field by field
**So that** the ledger the kernel computes from is mine alone, internally
consistent, and never silently re-priced (root SPEC §2, §9 screens 6–8, §11)

**Acceptance Criteria** (`docs/milestone-3-plan.md` "Writes"; decisions 19,
25, 26, 27):
- [x] AC-004.1: `lib/ledger/schemas.ts` (zod) validates every form in
      decimal strings and mirrors the database checks: quantity sign by
      type, `unit_price > 0`, `fees ≥ 0`, ISO 4217 currency, real dates.
      `parseFloat` / `Number(` are banned in `lib/ledger` by lint.
- [x] AC-004.2: Every action returns `{ ok: true, … } | { ok: false,
      reason, fields? }` with a closed reason set; a Supabase error message
      never reaches the browser.
- [x] AC-004.3: Asset create/edit validates `metadata` against the pack's
      `metadataSchema` and the identifier per `IdentifierSpec`; `pack_id`,
      `instrument_kind`, `identifier` and `native_currency` are immutable
      once the asset has a transaction, and delete refuses with
      `asset_has_transactions` (decision 27).
- [x] AC-004.4: Transactions carry `trade_date`, `type`, signed
      `quantity`, `unit_price`, `currency`, `fees`, optional `note`;
      editing or deleting one recomputes everything downstream (the
      decision 20 trigger, US-006).
- [x] AC-004.5: Cash flows are entered in the base currency only
      (decision 25); a zero amount is refused.
- [x] AC-004.6: The base currency locks at the first transaction:
      `changeBaseCurrency` refuses with `base_locked` unless
      `confirmReset: true`, which changes it and drops every snapshot
      (decision 26).
- [x] AC-004.7: A dbtest proves a second user cannot read, reference or
      mutate the first user's rows (RLS and the composite FKs), and that
      the pages `/assets`, `/transactions`, `/cash-flows` list only the
      signed-in user's rows.

**Test Scenarios**:
```
Given: an asset with one transaction
When:  the owner edits its identifier
Then:  the action returns { ok: false, reason: "asset_identity_locked" }

Given: a transaction form with type sell and quantity 10
When:  submitted
Then:  the action returns a field error on quantity before any database call

Given: user B knows user A's asset id
When:  B submits a transaction for it
Then:  the action returns not_found and no row is written
```

**Priority**: Must Have
**Status**: Done (2026-09-20)

---

### US-005: Price what I hold

**As a** the owner
**I want** a new asset to be priced automatically, to enter a price by hand
when a source cannot, and to retry everything unpriced at once
**So that** I see a number without waiting for the nightly cron, and a
number I typed is never overwritten by a source (root SPEC §9.4, §2 prices)

**Acceptance Criteria** (`docs/milestone-3-plan.md` "Keys and clients";
decisions 29, 30):
- [x] AC-005.1: Creating an asset commits the row first; only then does
      the action schedule `runIngest({ kind: "assets", assetIds })` through
      `after()` under the service role in `lib/jobs`, followed by
      `runSnapshots({ kind: "users" })`. A fetch failure is never a form
      error.
- [x] AC-005.2: The service-role client is constructed only in
      `app/api/cron/**` and `lib/jobs/**`; `pnpm lint` fails on any other
      import of `@/lib/supabase/service`.
- [x] AC-005.3: The asset list shows, per asset, the latest price with its
      `source_id` and date, or *unpriced* with the source's
      `ingest_cursors.last_error` when there is one.
- [x] AC-005.4: A manual price form on the asset writes
      `prices.source_id = 'manual'`; `commit_ingest_chunk` never overwrites
      it (already proven in `store.dbtest.ts`).
- [x] AC-005.5: Refresh runs `runIngest({ kind: "unpriced" })` then
      snapshots for the user, after the response, within the route budget.
- [x] AC-005.6: Server-action routes export `maxDuration = 60`; the
      after-response jobs receive the remaining budget.

**Test Scenarios**:
```
Given: an asset created with a source whose env var is absent
When:  the after-response ingest runs
Then:  the asset row shows unpriced with missing_env:<VAR>, and the create
       action had already returned ok

Given: a manual price for today
When:  the nightly cron ingests the same date
Then:  the manual row stands (manual_protected = 1)
```

**Priority**: Must Have
**Status**: Done (2026-09-20)

---

### US-006: Snapshots follow the ledger

**As a** the owner
**I want** daily valuations to be built from my ledger by a resumable job
and rebuilt whenever I change history
**So that** every chart and return is a pure function of what I recorded
and never a stale cache (root SPEC §8, §11; Milestone 2 decision 6)

**Acceptance Criteria** (`docs/milestone-3-plan.md` "The snapshot
invariant" and "The snapshot job"; decisions 20, 21, 22):
- [x] AC-006.1: A forward migration adds `price_date`, `fx_date` and
      `status` to `portfolio_snapshots` and the `invalidate_snapshots`
      trigger family on `transactions`, `prices` and
      `user_settings.base_currency`.
- [x] AC-006.2: A dbtest proves each trigger deletes exactly the user's
      snapshots from the touched date forward (all of them for a base
      currency change) and nothing of another user's.
- [x] AC-006.3: `lib/jobs/snapshots.ts` `runSnapshots` builds per user
      from `max(snapshot date) + 1` (or the earliest trade date), over the
      union of the enabled packs' business days, one day at a time, each
      day one atomic upsert of `valuePortfolio(...).holdings`, and stops
      cleanly when the budget is exhausted so the next trigger resumes.
- [x] AC-006.4: Every kernel-bound read casts numerics to text
      (`lib/ledger/rows.ts`); no value passes through a JS number.
- [x] AC-006.5: `GET /api/cron/snapshots` replaces the 501 stub, is
      authorised by `lib/cron/auth.ts`, runs all users and returns counts
      only; `budget.test.ts` enforces its `maxDuration` literal.
- [x] AC-006.6: A dbtest runs the job over the BR golden portfolio and the
      per-date totals equal `expected.json`'s `valuations`; the missing
      FII price on 2026-02-19 yields `status = 'carried_forward'` and
      `price_date = '2026-02-18'`.

**Test Scenarios**:
```
Given: snapshots exist through 2026-02-27 and a transaction is inserted
       dated 2026-02-12
When:  the insert commits
Then:  snapshots from 2026-02-12 forward are gone; earlier ones remain

Given: a budget that allows two days of building
When:  runSnapshots runs twice
Then:  the second run continues from the first run's last day + 1
```

**Priority**: Must Have
**Status**: Done (2026-09-20)

---

### US-007: Import my history

**As a** the owner
**I want** to upload a CSV of my past transactions, map its columns once,
review every row before anything is written, and commit all or nothing
**So that** years of history enter the ledger without hand entry and
without a half-imported file corrupting my figures (root SPEC §9.1)

**Acceptance Criteria** (`docs/milestone-3-plan.md` "CSV import";
decisions 23, 24):
- [x] AC-007.1: `lib/csv/parse.ts` and `write.ts` implement RFC 4180
      (quoted fields, doubled quotes, CRLF, BOM) with no dependency; a
      `fast-check` property proves `parse(write(rows)) = rows`.
- [x] AC-007.2: The canonical columns are SPEC §9.1's; a header map is
      applied first, saved to `user_settings.csv_column_map`, and reused;
      unknown columns are ignored; a missing required column is a
      file-level error.
- [x] AC-007.3: The dry run writes nothing and shows per row: parsed
      values, validation errors, the resolved asset or *unresolved*, and
      *duplicate* when `(asset_id, trade_date, type, quantity,
      unit_price)` matches an existing transaction.
- [x] AC-007.4: Unresolved identifiers are created inline from the
      preview through the asset action (pack and kind from the CSV,
      metadata prompted per the pack schema); import never invents an
      asset.
- [x] AC-007.5: Commit re-validates and refuses if the preview hash
      differs, any row has an error, or any identifier is unresolved;
      duplicates are skipped unless force-included; the insert is one bulk
      statement. Import writes `transactions` only.
- [x] AC-007.6: Re-importing the same file is a no-op — a property test
      over generated ledgers and a dbtest.
- [x] AC-007.7: `README.md` documents the format, and the JSON export's
      companion `transactions-YYYY-MM-DD.csv` is written by `lib/csv` so
      the app's own export imports as a no-op.

**Test Scenarios**:
```
Given: a CSV whose row 7 has quantity "abc"
When:  commit is attempted
Then:  nothing is written and row 7 is listed with a field error

Given: the same CSV imported twice
When:  the second commit runs
Then:  every row is a duplicate and zero transactions are inserted
```

**Priority**: Must Have
**Status**: Done (2026-09-20)

---

### US-008: Own my data

**As a** the owner
**I want** Settings to let me export and restore my ledger, delete
everything, enable packs, and set theme and locale
**So that** losing the host is recoverable and the instance is mine to
configure and to wipe (root SPEC §12.3, §9.6; PACKS §12)

**Acceptance Criteria** (`docs/milestone-3-plan.md` Phase 6; decisions 26,
28, 29):
- [x] AC-008.1: Export produces `finance-finder-YYYY-MM-DD.json` through
      `export_backup()` + `serializeBackup` and `transactions-YYYY-MM-DD.csv`
      through `lib/csv`, and stamps `user_settings.last_export_at`.
- [x] AC-008.2: Restore parses with `parseBackup`, shows `planRestore`'s
      warnings, and calls `restore_backup`; a non-empty account is refused
      with the fixed reason.
- [x] AC-008.3: Delete everything requires the phrase typed and a fresh
      password check, then deletes the `auth.users` row through `lib/jobs`
      under the service role; every user table cascades; the user is
      redirected to `/login`.
- [x] AC-008.4: Enabled packs are chosen from the registry with each
      pack's status shown; draft packs are allowed with a banner,
      `unmaintained` refused; enabling a pack runs `runIngest({ kind:
      "new_packs" })` after the response.
- [x] AC-008.5: Base currency, theme and locale are editable; the base
      currency lock and reset behave as US-004 AC-004.6.
- [x] AC-008.6: Security: change password, enrol / remove TOTP (QR +
      confirm code; removal needs AAL2), sign out everywhere.
- [x] AC-008.7: `app/login/page.tsx` exists and `pnpm release:check` is red
      only on the two draft packs and `specs/PERSONAS.md`.

**Test Scenarios**:
```
Given: an account with three assets
When:  the owner exports
Then:  the JSON parses with parseBackup, last_export_at is set, and the CSV
       imports back as a no-op

Given: the owner types the phrase and the right password
When:  delete everything runs
Then:  the auth user is gone, every user table has zero rows for that id
```

**Priority**: Must Have
**Status**: Done (2026-09-20)

---

## Technical Constraints

From `CLAUDE.md` non-negotiables and the root `SPEC.md` §12; these apply to
every story:

- Money and rates are `decimal.js` in the kernel and decimal strings at every
  boundary. Never `parseFloat`, never a JS `number` for a value. Rate strings
  use unit form (`"0.12"` = 12%).
- Packs supply data, identifiers and mappings; packs never supply math
  (PACKS.md §1). Packs never import from `lib/`, add npm deps or use global
  `fetch`.
- `series_points`, `ingest_watermarks` and `ingest_cursors` have no
  `user_id` and no RLS by design; only the service role writes them.
- `transactions` and `portfolio_snapshots` are never touched by pack work.
- Logs carry ids, counts, status codes and durations — never row values,
  never a full pack URL. No analytics, telemetry or error-reporting SaaS.
- Auth reads identity with `getUser()`, never `getSession()`. Cron auth uses
  `lib/cron/auth.ts` and fails closed under a 32-byte secret.
- The initial migration is applied and frozen; every schema change is a
  forward migration.
- `pnpm release:check` must pass before real portfolio data is entered.

## Out of Scope

Explicitly NOT building (ARCHITECTURE §2; `docs/milestone-2-plan.md`
"Non-goals"):

- Tax or fiscal reporting of any kind — ever.
- Broker integrations, order execution, or any write to an external account.
- Analytics, telemetry, or error-reporting services.
- In Milestone 3 specifically: the design system, the analysis screens,
  the status strip, the first-run card, privacy mode, empty-state copy and
  an accessibility pass (Milestone 5); OAuth, a signup route, email-link
  MFA recovery; foreign-currency cash flows, broker-specific or multi-file
  import, assets in bulk; the UK pack; deriving `fx_rate` on transactions;
  a browser end-to-end runner.

## Success Metrics

How we know this works:

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Golden reproduction | Every figure within `1e-8` of `expected.json` | `pnpm test:packs`, 1 skip |
| Kernel purity | 0 banned imports or float calls in `lib/calc/` | `pnpm lint` |
| Property coverage | Every property named in plan Phases 1–4 has a `fast-check` test | `pnpm test:calc` without `--passWithNoTests` |
| Recovery | export→delete→restore→export deep-equal modulo `exported_at` | `pnpm test:db` |
| Release gate (M2) | `release:check` red only on login, draft packs, `PERSONAS.md` | `pnpm release:check` |
| Trust boundaries (M3) | 0 `getSession` calls; 0 service-role imports outside cron/jobs | `pnpm lint` |
| Snapshot invariant (M3) | every history-changing write drops snapshots from its date forward | `pnpm test:db` trigger family |
| Import idempotence (M3) | re-importing a file inserts 0 rows | `fast-check` + `pnpm test:db` |
| Release gate (M3) | `release:check` red only on draft packs, `PERSONAS.md` | `pnpm release:check` — met 2026-09-20 |

---

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-05 | Initial spec | Project kickoff |
| 2026-09-20 | Vision, constraints, US-001 and US-002 filled | Milestone 2 Phase 0 step 6 (`docs/milestone-2-plan.md`) |
| 2026-09-20 | US-001 status: Phases 0–2 merged | Stale-doc correction alongside the Phase 3–7 grounding in the plan |
| 2026-09-20 | US-001 and US-002 done; every AC ticked; AC-002.7 restated as canonical-form equality; scenario 1 has four flows | Milestone 2 Phases 3–7 delivered (`docs/milestone-2-plan.md`) |
| 2026-09-20 | US-003 to US-008 added; out-of-scope and metrics extended for Milestone 3 | Milestone 3 Phase 0 step 5 (`docs/milestone-3-plan.md`) |
| 2026-09-20 | US-003 to US-008 done; every AC ticked | Milestone 3 Phases 1–7 delivered (`docs/milestone-3-plan.md`) |
