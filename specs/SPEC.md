# Finance Finder Specification

> ⚠️ **This is the source of truth for user stories and acceptance criteria.**
> The technical spec is the root `SPEC.md`; the architecture is `PACKS.md` and
> `ARCHITECTURE.md`; the build order is `MILESTONES.md`. Every story here cites
> the design document that owns its behaviour, and the QA gates in
> `.claude/CLAUDE.md` check implementations against the acceptance criteria
> below.
> Last updated: 2026-09-21 (Milestone 4 stories)

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
Milestone 3 (ledger, login) stories arrived with its plan; Milestone 4
("Brazil to production": the ten designed screens, `br.stock`, budgets,
smoke journeys, the first deploy) adds US-009 to US-014 and fills
`PERSONAS.md`, this being the first user-facing milestone.

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
Given: packs/br/fixtures/portfolio.json (seven instrument kinds since
       br.stock, ten transactions incl. one sell and one dividend, five cash
       flows — a deposit on each purchase day and the sale's withdrawal — six
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
- [x] AC-004.2: Every action returns `{ ok: true, … } | { ok: false, reason, fields? }`
      with a closed reason set; a Supabase error message never reaches the
      browser.
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
      `source_id` and date, or _unpriced_ with the source's
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
      values, validation errors, the resolved asset or _unresolved_, and
      _duplicate_ when `(asset_id, trade_date, type, quantity, unit_price)`
      matches an existing transaction.
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
      `unmaintained` refused; enabling a pack runs
      `runIngest({ kind: "new_packs" })` after the response.
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

### US-009: See my portfolio at a glance

**As a** the owner (Marina, `PERSONAS.md`)
**I want** the Overview to show what my portfolio is worth today in my base
currency, how it moved, how it is allocated, and — on a fresh instance —
exactly what to do next
**So that** one screen answers the first question every evening, and the
product teaches itself instead of hiding behind a wizard (root SPEC §9
screen 1, §9.2, §9.3, §9.5)

**Acceptance Criteria** (`docs/milestone-4-plan.md` Phase 2; decisions 36,
39, 40; `docs/milestone-4-execution.md` P2-U3–P2-U5):

- [ ] AC-009.1: `/` renders the §9.2 navigation — the Analysis and Ledger
      groups always fully visible, the theme toggle, sign out — with a
      hairline rule beneath, and the status strip only when something is
      pending, each item linking to the screen that resolves it, Refresh
      its only control. (SPEC §9.2)
- [ ] AC-009.2: The §9.3 first-run card renders above the content, derived
      from row counts on every render; it disappears as steps complete and
      reappears if data is deleted; steps are ordered but never gated.
      (SPEC §9.3)
- [ ] AC-009.3: The headline is the kernel's confident total at today in
      the base currency (`valuePortfolio` over a latest-price ledger read);
      "—" with _N assets unpriced_ when no position is priced; stale and
      unpriced holdings are never summed into it. (SPEC §9.5 row 1, §11)
- [ ] AC-009.4: Day change comes from the last two snapshot totals and
      period change from the first total in range — signed, coloured with
      `--pos`/`--neg`, with an arrow; below two snapshots the copy is
      "History starts after tonight's snapshot." (SPEC §9.5 row 2)
- [ ] AC-009.5: A sparkline of confident totals, an allocation donut by
      instrument kind from today's holdings, and top movers by per-asset
      day change. (SPEC §9 screen 1)
- [ ] AC-009.6: Every value is printed by `lib/format` from a decimal
      string per `user_settings.locale`; the only `Number(` on a value in
      `app/` or `lib/` source is `app/(app)/_charts/coordinate.ts`.
      (plan "The number boundary"; decision 35)
- [ ] AC-009.7: Every string a person reads comes from `lib/copy` in the
      user's locale — English or Brazilian Portuguese. (decision 34)

**Test Scenarios**:

```
Given: a fresh instance — one bootstrapped owner, zero rows elsewhere
When:  the owner opens /
Then:  the four-step card shows with steps 1–4 open; the headline is "—";
       no status strip; the nav shows every route

Given: one asset created without BRAPI_TOKEN set
When:  the owner opens /
Then:  the strip says "1 asset unpriced" and "source br.brapi disabled:
       BRAPI_TOKEN not set", each linking to its screen; the headline is "—"

Given: the golden ledger restored and snapshots built through 2026-02-27
When:  the owner opens / with locale pt-BR
Then:  the headline equals expected.json's total at asOf formatted
       "R$ 1.234,56"-style; day change shows a sign and an arrow; the
       sparkline has six points; the card is gone
```

**Priority**: Must Have
**Status**: Planned (Milestone 4 Phase 2)

---

### US-010: Compare my return

**As a** the owner
**I want** to see my time-weighted and money-weighted returns over a chosen
period against the benchmarks my market publishes, nominal or real
**So that** I know whether my decisions beat simply holding the index, and
whether I beat inflation (root SPEC §9 screen 2, §6)

**Acceptance Criteria** (plan Phase 3; decisions 36, 37; runbook P3-U1,
P3-U2):

- [ ] AC-010.1: A period selector 1M / YTD / 1Y / All (All = from the first
      snapshot); the default is All when history is shorter than a year,
      else 1Y. (plan Phase 3)
- [ ] AC-010.2: TWR over the period from snapshot confident totals and cash
      flows through `twr()` (start-of-day flows, `MILESTONES.md` §2
      decision 1), with skipped sub-periods listed; MWR through `mwr()`; a
      null figure shows its reason from `lib/copy`. (SPEC §6)
- [ ] AC-010.3: The chart plots the portfolio's cumulative return (the
      accent) against togglable `benchmark`-role series (muted), each point
      from `seriesReturn` at that snapshot date; the toggles come from the
      registry with no kind-specific code. (decision 37; ARCHITECTURE §8
      "Adding a new benchmark")
- [ ] AC-010.4: A nominal/real toggle applies the `deflator`-role series
      through `realReturn`; the toggle is hidden when the user's packs
      register no deflator. (SPEC §6)
- [ ] AC-010.5: The §9.5 empty states verbatim: "Needs two days of history
      to plot a return." below two snapshots; "Benchmarks arrive with the
      nightly ingest." when no benchmark series has points. (SPEC §9.5
      row 3)
- [ ] AC-010.6: A date with any stale row carries the stale mark in the
      tooltip; `prefers-reduced-motion` disables chart animation. (SPEC
      §11; plan "Accessibility")

**Test Scenarios**:

```
Given: the golden ledger with snapshots on its six valuation dates
When:  /performance?period=all
Then:  the TWR shown equals expected.json's twr to 1e-8 before formatting,
       the MWR its mwr, and the cumulative series' last point equals the TWR

Given: one snapshot only
When:  /performance
Then:  "Needs two days of history to plot a return." and no chart

Given: br.ibovespa toggled off and br.cdi on
When:  the page re-renders
Then:  the chart has the portfolio line and one muted CDI line
```

**Priority**: Must Have
**Status**: Planned (Milestone 4 Phase 3)

---

### US-011: See what I hold and what drove it

**As a** the owner
**I want** my allocation by kind, market and currency, and each asset's
contribution to the period's return — with the FX share separated for
foreign holdings
**So that** I can see concentration and know which decision, not which
exchange rate, made the difference (root SPEC §9 screens 3–4, §6, §11)

**Acceptance Criteria** (plan Phases 3–4; `MILESTONES.md` §2 decision 15;
runbook P3-U3, P4-U1):

- [ ] AC-011.1: Allocation by instrument kind, by pack and by currency from
      the latest snapshot rows, plus native-vs-base exposure; shares are
      2-decimal strings summing to exactly 100.00 (largest remainder);
      stale rows are excluded from shares and listed aside. (SPEC §9
      screen 3)
- [ ] AC-011.2: Contribution bars per asset over the period from
      `contribution()`; a partial total is flagged with its reasons; the
      sum shown equals the simple return shown. (SPEC §6)
- [ ] AC-011.3: `/contribution/[assetId]` shows `attribution()`'s R_native,
      R_fx and R_base with the identity
      `(1 + R_base) = (1 + R_native) × (1 + R_fx)` stated; a base-currency
      asset shows R_fx = 0 as a stated fact; the §11 BDR gap is stated once
      on the page. (SPEC §6, §11)
- [ ] AC-011.4: The §9.5 empty states verbatim: "Nothing to allocate yet."
      → Assets; "Contribution needs history across the period." (SPEC §9.5
      rows 4–5)

**Test Scenarios**:

```
Given: the golden asOf snapshot rows
When:  /allocation
Then:  six kinds (seven with br.stock) with shares summing to 100.00; BRL
       exposure native equals base

Given: the golden ledger over its six dates
When:  /contribution?period=all
Then:  the per-asset shares sum to the simple return between the first and
       last dates; every BR asset's drill-in shows R_fx = 0

Given: an asset whose FX series is missing on the period's start
When:  /contribution
Then:  that asset is null with reason no_fx_series and the total is flagged
       partial
```

**Priority**: Must Have
**Status**: Planned (Milestone 4 Phases 3–4)

---

### US-012: Know what matures when

**As a** the owner
**I want** a ladder of my fixed-income holdings by maturity date with what
each is worth now and, where the contract fixes it, at maturity
**So that** I plan liquidity and notice a matured bond whose redemption I
never recorded (root SPEC §9 screen 5; `MILESTONES.md` §2 decision 14, §4
decision 38)

**Acceptance Criteria** (plan Phase 4; PACKS §5 maturity sentence; runbook
P4-U2):

- [ ] AC-012.1: The ladder lists every held asset whose kind's
      `metadataSchema` has a `maturity` key, ordered by date, with days to
      go, the current value with its status mark, the contracted value at
      maturity for plain-rate accrual kinds (`valueHolding` at that date),
      and "final amount depends on the index" for indexed kinds. (decision 38)
- [ ] AC-012.2: A matured asset still held is marked "matured — record the
      redemption" and never valued as if alive without saying so.
      (decision 14)
- [ ] AC-012.3: A timeline view groups the ladder by month. (SPEC §9
      screen 5)
- [ ] AC-012.4: The §9.5 empty state verbatim ("No fixed-income holdings
      yet. Add a Tesouro Direto, CDB, LCI…" → Assets); detection reads the
      schema shape, never a kind id. (decision 42)

**Test Scenarios**:

```
Given: the golden ledger at asOf
When:  /maturities
Then:  four fixed-income assets in date order; br.cdb_prefixado's contracted
       value equals valueAccrual at its maturity; br.cdb_ipca shows the
       index sentence; br.tesouro_direto (NAV) shows no contracted value

Given: a CDB with maturity 2025-01-01 still held today
When:  /maturities
Then:  the row carries the matured mark

Given: a portfolio of FIIs only
When:  /maturities
Then:  the empty state with the Assets link
```

**Priority**: Must Have
**Status**: Planned (Milestone 4 Phase 4)

---

### US-013: Use it on my phone, in my theme, in front of others

**As a** the owner
**I want** every screen to work on my phone in light or dark, in my
language, with amounts hidden at a tap, and every stale or missing number
marked as such
**So that** I check my portfolio wherever I am without a confident number
ever being wrong or seen by the wrong person (root SPEC §10, §11, §12.3,
§9.5, §9 screens 6–10)

**Acceptance Criteria** (plan Phases 2, 5, 7; decisions 34, 40, 47, 48;
runbook P2-U1, P2-U3, P5-U1–P5-U3, P7-U2):

- [ ] AC-013.1: `app/globals.css` defines exactly the §10 tokens for light
      and dark; `data-theme` on `<html>` comes from the user's setting with
      no flash; `system` follows `prefers-color-scheme`; the nav toggle
      persists the setting. (SPEC §10; ARCHITECTURE §7)
- [ ] AC-013.2: Instrument Serif through `next/font` for display headings
      and large figures, the system sans stack elsewhere, tabular numerals
      on every figure. (SPEC §10, §12.1 fonts)
- [ ] AC-013.3: Privacy mode — a toggle beside the theme switch, remembered
      in `localStorage`, masks every amount and quantity as `•••` through
      one `<Amount>` component; names, percentages and returns stay
      visible; nothing is sent to the server. (SPEC §12.3; decision 40)
- [ ] AC-013.4: Every screen works at 400 px: the nav collapses to a menu,
      tables stack or scroll inside their own container, the page never
      scrolls horizontally. (SPEC §9.2; ARCHITECTURE §2 mobile browsers)
- [ ] AC-013.5: Landmarks, a skip link, labelled controls, visible focus,
      `aria-live` on the strip, `loading.tsx` and `error.tsx` with fixed
      copy and no stack, AA contrast for every token pair in both themes,
      reduced motion respected. (plan "Accessibility")
- [ ] AC-013.6: `<ValueStatus>` marks carried-forward, stale and unpriced on
      every screen; an unpriced position shows its quantity and _unpriced_,
      never zero. (SPEC §9.5 last paragraph, §11)
- [ ] AC-013.7: Assets, Transactions, Import, Cash flows, Settings, Login,
      MFA and reset are restyled on the tokens; the asset form is pack →
      kind → generated metadata fields → currency
      (`lib/forms/zod-fields.ts`); the JSON textarea is gone. (SPEC §9
      screen 6; decision 45)
- [ ] AC-013.8: Changing `locale` in Settings changes the copy language and
      the formatting; both dictionaries are complete (a test proves it).
      (decision 34)

**Test Scenarios**:

```
Given: the owner sets theme dark and locale pt-BR in Settings
When:  they reload any page
Then:  <html data-theme="dark" lang="pt-BR"> is in the first HTML response;
       no light frame paints; every string is Portuguese

Given: privacy mode on
When:  the owner opens /assets
Then:  every amount and quantity cell reads •••; identifiers and percentages
       are visible; reloading keeps the mask

Given: a 400 px viewport
When:  every route is opened
Then:  document.scrollWidth equals the viewport width on each; the menu
       opens and lists every route
```

**Priority**: Must Have
**Status**: Planned (Milestone 4 Phases 2–7)

---

### US-014: Run it in production

**As a** the owner
**I want** to deploy the app to my own Vercel and Supabase accounts by a
runbook, with a CI that proves every tier and a release gate that permits
real data only when everything is green
**So that** the first real transaction I enter lands in an instance that
has been tested end to end, not in a scaffold (root SPEC §12; PACKS §12;
ARCHITECTURE §8; `MILESTONES.md` production-data gate)

**Acceptance Criteria** (plan Phases 1, 6–9; decisions 41, 43, 44, 46, 49,
50, 51; runbook P1-U1–P1-U8, P6-U1–P9-U1):

- [ ] AC-014.1: CI on the GitHub remote runs typecheck, lint, format:check,
      test with coverage thresholds, test:packs, test:db, the
      `lib/database.types.ts` diff, audit, e2e and build, and is green on
      `main`. (decisions 49, 50; plan D-01–D-04)
- [ ] AC-014.2: Every response carries decision 51's headers; the CSP nonce
      is per request; the e2e journeys record zero CSP violations.
      (decision 51)
- [ ] AC-014.3: `docs/performance-budgets.md` records `runSnapshots` ≥ 50
      days/s and every screen read < 500 ms p50 on the synthetic
      five-year, twenty-asset ledger. (decision 44)
- [ ] AC-014.4: `pnpm test:e2e` passes the eight journeys of decision 46
      plus the security-boundary journey of decision 40 (every data route
      redirects when signed out and at AAL1 with a factor). (decisions 40, 46)
- [ ] AC-014.5: `packs/br` and `packs/global` are `supported` with fixtures
      at most 90 days old; `pnpm test:packs` reports exactly one skip
      (`global`, no instruments). (PACKS §12; decision 41)
- [ ] AC-014.6: `docs/DEPLOY.md` and `.env.example` are complete;
      `pnpm release:check` is green locally and in CI. (ARCHITECTURE §8;
      decision 43)
- [ ] AC-014.7: The first deploy is recorded in `MILESTONES.md` §4 with
      both crons observed firing (maintainer). (decision 43)

**Test Scenarios**:

```
Given: a push to main
When:  CI runs
Then:  every job is green, including test:db against a stack the job
       started and the e2e journeys against a built app

Given: a signed-out browser
When:  it requests /, /performance, /settings and /settings/export/json
Then:  every response is a redirect to /login carrying the CSP, HSTS (in
       production), nosniff, no-referrer and frame-ancestors headers

Given: the synthetic five-year ledger seeded for a throwaway user
When:  runSnapshots runs with a generous budget
Then:  it builds at ≥ 50 days per second and the number is in the doc
```

**Priority**: Must Have
**Status**: Planned (Milestone 4 Phases 1–9)

---

### US-015: See what I hold

**As a** the owner (Marina, `PERSONAS.md`)
**I want** one screen that lists every holding with its quantity, what it cost
me, what it is worth and what it has gained — and a list of transactions I can
narrow to the ones I am looking for
**So that** "what do I actually own" is a screen rather than an inference from
three other screens, and a ledger of years is navigable (root SPEC §6, §9
screens 6–7, §9.5, §11)

**Acceptance Criteria** (`docs/milestone-4-gaps.md` G-U2–G-U4; decisions 58,
59, 60, 64):

- [ ] AC-015.1: `/assets` lists every asset with today's quantity from its FIFO
      lots, average cost and open cost _before fees_, the latest price with its
      state, market value in the base currency, and unrealised gain as money and
      a rate with a sign and an arrow. An asset with no transactions shows "—";
      an unpriced or stale holding shows no unrealised figure. (SPEC §6, §9
      screen 6, §9.5, §11)
- [ ] AC-015.2: The table's foot carries the confident total in the base
      currency and, when any holding is outside it, how many — and that total
      equals the Overview headline on the same data. (decision 60)
- [ ] AC-015.3: `/assets/[id]` lists the open lots (opened, quantity, unit
      price, cost) in FIFO order with the position's totals, above the manual
      prices already there. (SPEC §6)
- [ ] AC-015.4: Every quantity, cost, value and gain is masked by privacy mode
      and printed by `lib/format` from a decimal string; the only `Number(` on a
      value stays `app/(app)/_charts/coordinate.ts`. (decision 35)
- [ ] AC-015.5: `/transactions` filters by asset, type and date range applied by
      the database before `.range()`; paging preserves the filter; an invalid
      value is ignored field by field; the filtered count is shown. (decision 64)
- [ ] AC-015.6: A sell beyond the open position is refused with `oversell` on
      `quantity` by the transaction form, by an edit that would leave later
      sells uncovered, and by the import preview (which marks the row and blocks
      the commit). A ledger that still contains one shows that asset's row as a
      ledger error and every derived screen says so instead of failing.
      (decision 58, SPEC §6, §11)

**Test Scenarios**:

```
Given: the golden ledger and snapshots
When:  the owner opens /assets
Then:  each row shows quantity, average cost, price, value and unrealised;
       the foot total equals the Overview headline to the last digit

Given: an asset bought 10 @ 100 then 10 @ 120, with 5 sold
When:  its asset page is opened
Then:  the open lots are 5 @ 100 and 10 @ 120, quantity 15, open cost
       1700, average cost 113.333…, all labelled before fees

Given: a position of 10 units
When:  a sell of 100 is submitted on the form, in an edit, or in a CSV
Then:  each path refuses with oversell on quantity and writes nothing
```

**Priority**: Must Have
**Status**: Planned (Milestone 4 gaps)

---

### US-016: Know my instance is alive

**As a** the owner running this on my own Vercel and Supabase
**I want** the app itself to tell me when its crons stopped, when a source is
failing, and how much data it holds
**So that** a self-hosted instance cannot rot in silence behind prices that
carry forward and still look like numbers (root SPEC §8, §9.2, §9.4, §11,
§12.3)

**Acceptance Criteria** (`docs/milestone-4-gaps.md` G-U5; decisions 61, 62, 63,
65):

- [ ] AC-016.1: The strip says "no price run since <date>" when the latest
      `ingest_cursors.last_run_at` across the user's activated sources is older
      than two trading days (silent for an account's first two trading days);
      "source <id> failing: <reason>" for a source with `last_error`; and
      "history stopped at <date>" when a snapshot gap has had nothing written
      into it for two trading days. (decision 63)
- [ ] AC-016.2: Each links to Settings → Instance, which states per source its
      last run and error or the variable it wants, the snapshot marker with the
      time it was last written, and row counts — own tables exact through RLS,
      `series_points` estimated and labelled. (decisions 63, 65)
- [ ] AC-016.3: Disabling a pack whose assets are still held is refused with
      `pack_in_use` and nothing is written. (decision 61)
- [ ] AC-016.4: Refresh pressed while a run it started is still in its window
      schedules nothing; overlapping runs remain safe because every write is an
      idempotent upsert keyed by date. (decision 62)
- [ ] AC-016.5: Nothing is pruned; root SPEC §8 states the growth arithmetic and
      Settings shows the live counts. (decision 65)
- [ ] AC-016.6: No value, URL or secret appears in any log line, error message
      or screen this story adds — ids, counts, codes, dates and variable names
      only. (root SPEC §12.2)

**Test Scenarios**:

```
Given: an instance whose price cron last ran three trading days ago
When:  the owner opens any screen
Then:  the strip says no price run since that date and links to
       /settings#instance, which shows the same date per source

Given: the golden ledger held under pack br
When:  the owner unticks br in Settings and saves
Then:  the action returns pack_in_use, enabled_packs is unchanged, and the
       notice names the reason

Given: a Refresh that is still within its window
When:  Refresh is pressed again
Then:  no further job chain is scheduled and the strip says it is fetching
```

**Priority**: Must Have
**Status**: Planned (Milestone 4 gaps)

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
- In Milestone 3 specifically: OAuth, a signup route, email-link MFA
  recovery; foreign-currency cash flows, broker-specific or multi-file
  import, assets in bulk; deriving `fx_rate` on transactions.
- In Milestone 4 specifically (`docs/milestone-4-plan.md` "Non-goals"): a
  third language or per-pack copy; `packs/uk`, a second FX series,
  `indexation` for curve bonds, foreign-currency cash flows (Milestone 5);
  new user-data tables (migrations are read views and function bodies,
  decision 52); a cache for computed returns; a crypto source.

## Success Metrics

How we know this works:

| Metric                       | Target                                                                            | How to Measure                                              |
| ---------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Golden reproduction          | Every figure within `1e-8` of `expected.json`                                     | `pnpm test:packs`, 1 skip                                   |
| Kernel purity                | 0 banned imports or float calls in `lib/calc/`                                    | `pnpm lint`                                                 |
| Property coverage            | Every property named in plan Phases 1–4 has a `fast-check` test                   | `pnpm test:calc` without `--passWithNoTests`                |
| Recovery                     | export→delete→restore→export deep-equal modulo `exported_at`                      | `pnpm test:db`                                              |
| Release gate (M2)            | `release:check` red only on login, draft packs, `PERSONAS.md`                     | `pnpm release:check`                                        |
| Trust boundaries (M3)        | 0 `getSession` calls; 0 service-role imports outside cron/jobs                    | `pnpm lint`                                                 |
| Snapshot invariant (M3)      | every history-changing write drops snapshots from its date forward                | `pnpm test:db` trigger family                               |
| Import idempotence (M3)      | re-importing a file inserts 0 rows                                                | `fast-check` + `pnpm test:db`                               |
| Release gate (M3)            | `release:check` red only on draft packs, `PERSONAS.md`                            | `pnpm release:check` — met 2026-09-20                       |
| Neutrality (M4)              | 0 pack/currency/locale literals in `app/` and `lib/` source outside the allowlist | `packs/conformance/kernel-neutrality.test.ts`               |
| Golden with seven kinds (M4) | every figure within `1e-8` after `br.stock` joins                                 | `pnpm test:packs`, 1 skip                                   |
| Copy completeness (M4)       | `en` and `pt-BR` have identical key sets, no empty leaf                           | `lib/copy/copy.test.ts`                                     |
| Budgets (M4)                 | `runSnapshots` ≥ 50 days/s; every screen read < 500 ms p50                        | `FF_BUDGETS=1 pnpm test:db` → `docs/performance-budgets.md` |
| Journeys (M4)                | 9 e2e specs green, 0 CSP violations                                               | `pnpm test:e2e`                                             |
| Coverage (M4)                | `lib/calc` ≥ 95 %, the other `lib/` modules ≥ 85 %                                | `pnpm test:coverage`                                        |
| Release gate (M4)            | `release:check` fully green                                                       | `pnpm release:check` in CI                                  |

---

## Change Log

| Date       | Change                                                                                                           | Reason                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| 2026-09-05 | Initial spec                                                                                                     | Project kickoff                                                    |
| 2026-09-20 | Vision, constraints, US-001 and US-002 filled                                                                    | Milestone 2 Phase 0 step 6 (`docs/milestone-2-plan.md`)            |
| 2026-09-20 | US-001 status: Phases 0–2 merged                                                                                 | Stale-doc correction alongside the Phase 3–7 grounding in the plan |
| 2026-09-20 | US-001 and US-002 done; every AC ticked; AC-002.7 restated as canonical-form equality; scenario 1 has four flows | Milestone 2 Phases 3–7 delivered (`docs/milestone-2-plan.md`)      |
| 2026-09-20 | US-003 to US-008 added; out-of-scope and metrics extended for Milestone 3                                        | Milestone 3 Phase 0 step 5 (`docs/milestone-3-plan.md`)            |
| 2026-09-20 | US-003 to US-008 done; every AC ticked                                                                           | Milestone 3 Phases 1–7 delivered (`docs/milestone-3-plan.md`)      |
| 2026-09-21 | US-009 to US-014 added; out-of-scope and metrics extended for Milestone 4                                        | Milestone 4 Phase 0 (`docs/milestone-4-execution.md` P0-U2)        |
| 2026-09-23 | US-015 and US-016 added                                                                                          | Spec gaps found by the Phase 5 review (`docs/milestone-4-gaps.md`) |
