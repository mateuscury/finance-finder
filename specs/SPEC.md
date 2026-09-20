# Finance Finder Specification

> ⚠️ **This is the source of truth for user stories and acceptance criteria.**
> The technical spec is the root `SPEC.md`; the architecture is `PACKS.md` and
> `ARCHITECTURE.md`; the build order is `MILESTONES.md`. Every story here cites
> the design document that owns its behaviour, and the QA gates in
> `.claude/CLAUDE.md` check implementations against the acceptance criteria
> below.
> Last updated: 2026-09-20

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
- In Milestone 2 specifically: screens, server actions, login, CSV export
  (belongs with CSV import in Milestone 3), the snapshot cron route and its
  invalidation triggers (Milestone 3), the UK pack and
  `curve_mark_to_market` indexation (Milestone 4), promoting any pack to
  `supported`, and any schema change beyond the two backup RPCs.

## Success Metrics

How we know this works:

| Metric | Target | How to Measure |
|--------|--------|----------------|
| Golden reproduction | Every figure within `1e-8` of `expected.json` | `pnpm test:packs`, 1 skip |
| Kernel purity | 0 banned imports or float calls in `lib/calc/` | `pnpm lint` |
| Property coverage | Every property named in plan Phases 1–4 has a `fast-check` test | `pnpm test:calc` without `--passWithNoTests` |
| Recovery | export→delete→restore→export deep-equal modulo `exported_at` | `pnpm test:db` |
| Release gate | `release:check` red only on login, draft packs, `PERSONAS.md` | `pnpm release:check` |

---

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-09-05 | Initial spec | Project kickoff |
| 2026-09-20 | Vision, constraints, US-001 and US-002 filled | Milestone 2 Phase 0 step 6 (`docs/milestone-2-plan.md`) |
| 2026-09-20 | US-001 status: Phases 0–2 merged | Stale-doc correction alongside the Phase 3–7 grounding in the plan |
| 2026-09-20 | US-001 and US-002 done; every AC ticked; AC-002.7 restated as canonical-form equality; scenario 1 has four flows | Milestone 2 Phases 3–7 delivered (`docs/milestone-2-plan.md`) |
