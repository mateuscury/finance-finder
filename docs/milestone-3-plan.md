# Milestone 3 — Authenticated ledger: implementation plan

Drafted 2026-09-20 from the tree as it stands after Milestone 2 (`8e417a8`).
`MILESTONES.md` §3 is the scope authority; `SPEC.md` §8, §9.1, §9.3, §9.4,
§9.6, §11 and §12.3 own the behaviour. This document fixes the conventions
the ledger and auth layers are built under, lists the decisions that must be
confirmed before code is written, and defines the phases and merge order.
Every merge unit leaves `pnpm test` and `pnpm test:db` green on `main` and
runs the loop in `.claude/CLAUDE.md`: plan → build → gates →
`/qa-spec-fidelity` → `/qa-code-quality` → fix Must/Should → record
Advisory → next phase.

## Outcome

Milestone 3 ends with an owner who can sign in (password, then TOTP when
enrolled), keep a ledger — assets, transactions, cash flows, manual prices —
through validated server actions behind RLS, bulk-load history through a
dry-run CSV import that is all-or-nothing on commit, export and restore the
ledger from Settings, and see every figure the kernel computes reflected in
`portfolio_snapshots` by a resumable snapshot job that a ledger change can
never leave stale. `app/login/page.tsx` exists and `pnpm release:check` is
red only on the two draft packs and `specs/PERSONAS.md`.

It does **not** ship the designed screens (SPEC §10 applies in Milestone 5),
the analysis screens, privacy mode, the status strip, the first-run card, or
the UK pack. Pages in this milestone are functional and unstyled (decision
19): semantic HTML, native forms, server actions — enough to exercise every
flow end to end and for a person to use the product, not enough to call it
finished.

## Progress

| Phase | Merge unit | Status |
|---|---|---|
| 0 — Baseline, decisions, stories, dependencies | (this commit) | merged |
| 1 — Sessions and login | (this commit) | merged |
| 2 — Data access layer and ledger reads | (this commit) | merged |
| 3 — Snapshot invalidation, snapshot job, cron route | (this commit) | merged |
| 4 — Asset, transaction, cash-flow and manual-price flows | — | not started |
| 5 — CSV import | — | not started |
| 6 — Settings: security and your data | — | not started |
| 7 — Documentation and gates | — | not started |

## Why the conventions below are written down first

Milestone 2 pinned arithmetic so a fixture could be derived independently.
This milestone pins **trust boundaries**: which code may hold which key,
which check happens where, and which write invalidates what. Those are the
rules a later contributor is most likely to erode by accident — a service
role client "just for this one read" — so they are stated once, here, and
enforced by lint and the database wherever a rule can be.

### Identity and sessions

- **`@supabase/ssr` cookie sessions.** One server client factory,
  `lib/supabase/server.ts`, builds a `createServerClient` on the ANON key
  with Next's `cookies()` adapter; one browser factory,
  `lib/supabase/browser.ts`, exists only for the MFA enrolment widget and
  nothing else fetches from the client (ARCHITECTURE §4.6). Cookies are
  `httpOnly`, `Secure` outside development, `SameSite=Lax`.
- **`proxy.ts` refreshes and redirects optimistically; it never decides.**
  It calls `getUser()` so an expired access token is refreshed on every
  request (the SSR library rewrites the cookie), sends an unauthenticated
  request for a data route to `/login`, and an AAL1 session that has a
  verified factor to `/login/mfa`. Per the Next 16 guide, it is an
  optimistic check: every page and every server action re-establishes
  identity through the DAL below.
- **The DAL is the only path to a user.** `lib/auth/session.ts` exports
  `requireUser()` — `getUser()` (verified against Auth, never
  `getSession()`), then `mfa.getAuthenticatorAssuranceLevel()`; when
  `nextLevel === "aal2"` and `currentLevel !== "aal2"` it redirects to
  `/login/mfa`; unauthenticated redirects to `/login`. Wrapped in React
  `cache` so a render pass verifies once. Every page under `app/(app)/` and
  every server action calls it first, before reading a form field. Lint
  bans `getSession` project-wide.
- **Uniform failure.** The login action returns one fixed message for a
  wrong password, an unknown email and a disabled account; the code never
  branches on the error kind. Throttling is Supabase Auth's own.
- **Second factor.** Enrolment (`mfa.enroll` → QR → `challenge` +
  `verify`) lives in Settings and is the one client component that talks to
  Supabase directly, because the QR must be shown before the factor exists.
  The challenge page at `/login/mfa` is a server-action form. Unenrolment
  requires an AAL2 session. Recovery stays `pnpm bootstrap:user
  --reset-mfa`.
- **Sign out.** `signOut({ scope: "local" })` from the nav; `scope:
  "global"` from Settings ("sign out everywhere").
- **Password.** Change from Settings through `updateUser({ password })`
  (Auth's secure-password-change reauthentication applies as configured).
  Reset through `resetPasswordForEmail` with a fixed "if that address has
  an account, an email was sent" message and a `/login/reset` page that
  completes it; locally the mail lands in Inbucket.

### Keys and clients

- **The anon key + the user's cookie is the only client user-facing code
  constructs.** RLS scopes every read and write. The composite
  `(asset_id, user_id)` foreign keys make a cross-owner reference a
  constraint error even if a check were forgotten.
- **The service role is constructed in exactly three places**: the two
  cron routes and `lib/jobs/*` runners — and a server action may invoke a
  runner **only** with a scope it derived through the user's own RLS
  client (the asset ids it just created; its own user id). A runner never
  reads a form field. This is how SPEC §9.4's "server action calls the
  ingest job under the service role" coexists with ARCHITECTURE §4.3's
  "never use the service role key in user-facing code paths": the key
  reaches the job layer, never the request layer. Lint bans
  `@/lib/supabase/service` outside `app/api/cron/**` and `lib/jobs/**`.

### Reads

- **Every collection read is paginated** through one helper,
  `lib/supabase/paginate.ts` (`readAll`, moved out of `lib/packs/store.ts`
  and shared), because PostgREST caps a response at `api.max_rows = 1000`
  and treats the cap as the answer. Filters go before `.range()`.
- **Money leaves the database as text.** Every kernel-bound select casts
  numerics (`select("quantity::text,unit_price::text,…")`, proven in
  `store.dbtest.ts`) or goes through a jsonb RPC (`export_backup` is the
  model). A bare numeric column in a select that feeds `lib/calc` is a
  review failure; the row-mapping functions in `lib/ledger/rows.ts` are the
  one place the casts are written.
- **Aggregate server-side when rows are not needed.** Counts for the
  first-run card and the "N assets unpriced" figure use `count: "exact",
  head: true`, never a full read.

### Writes

- **Validation is zod, at the action boundary, in decimal strings.** Forms
  submit strings; actions parse with schemas in `lib/ledger/schemas.ts`
  that mirror the database check constraints (sign by type, positive unit
  price, non-negative fees, ISO currency, real dates) so a rejected row is
  rejected with a field-level message before the database rejects it with a
  constraint name. `parseFloat` and `Number(` stay banned in `lib/ledger`
  as in the kernel.
- **Every action returns a typed result, never throws to the client**:
  `{ ok: true, … } | { ok: false, reason: <fixed code>, fields?: … }`. Reason
  codes are closed literals so a screen maps one line each; free text from
  Supabase never reaches the browser (it may name a column, a policy or a
  key).
- **Revalidation is by path** (`revalidatePath` of the ledger route that
  changed and of `/`), not by tag; the app has no tagged fetches.
- **Ownership is the database's job, checked twice.** The action reads the
  parent row through RLS before writing (a friendly `not_found`), and the
  composite FK refuses anything the read missed.

### The snapshot invariant

SPEC §8 and §11 say a write that changes history invalidates every snapshot
from the earliest touched date forward, "never patched in place, never left
stale". That is a database invariant, and it is enforced in the database
(decision 20): `AFTER INSERT OR UPDATE OR DELETE` row triggers on
`transactions` and `prices`, and an `AFTER UPDATE OF base_currency` trigger
on `user_settings`, delete the affected user's `portfolio_snapshots` rows
from the touched date forward. Every write path — a form, a CSV commit, a
manual price, a late pack price from the nightly cron, a restore, a base
currency reset — is covered without any of them remembering to do it.
Cash flows do not touch snapshots: a snapshot is a per-asset valuation and
flows enter TWR/MWR at read time (decision 16).

### The snapshot job

`lib/jobs/snapshots.ts` exports one `runSnapshots({ scope, budgetMs, store,
registry, now })`, shaped like `runIngest`: a narrow `SnapshotStore`
interface so the algorithm is unit-tested with a fake, and one
Supabase-backed implementation with paginated text-cast reads.

- **Scope**: `{ kind: "all_users" }` (cron) or `{ kind: "users"; userIds }`
  (after an import commit, after a first price, Refresh).
- **Marker**: per user, `max(snapshot date) + 1`, or the earliest trade
  date when no snapshot exists. No cursor table.
- **Calendar**: the portfolio's trading days are the union of the user's
  enabled packs' business days (decision 21); the job builds one snapshot
  per such day, in order, through the current UTC date when that day
  qualifies. Dates are UTC calendar dates, as everywhere else.
- **Per day**: `valuePortfolio(input, date)` from `lib/calc`; the rows
  written are exactly `PortfolioValuation.holdings` (decision 17) with the
  three columns decision 22 adds; `unpriced` assets write nothing. Each day
  is one upsert statement — atomic — so a budget exhaustion between days
  leaves a clean marker.
- **Budget**: the same per-invocation budget shape as ingestion
  (`lib/cron/budget.ts`), users ordered least-recently-snapshotted first so
  one long rebuild cannot starve the rest; a run that stops early is simply
  resumed by the next trigger.
- **Reads** (all `::text`): `user_settings` (base currency, enabled packs),
  `assets`, `transactions`, `prices` and `series_points` for the enabled
  packs' series, restricted to `[marker − 62 days, today]` plus each
  asset's lot-opening dates (accrual needs the index at `openedOn`).

### CSV import

- **Parser**: `lib/csv/parse.ts`, a hand-written RFC 4180 reader (quoted
  fields, doubled quotes, CRLF, BOM) with a matching writer used by the
  export, property-tested for round-trip. No dependency: the format is
  small and the project prefers reviewed code to a package (decision 23).
- **Canonical columns** are SPEC §9.1's. A header map `{ canonical →
  uploaded header }` is applied first; unknown columns are ignored; a
  missing required column is a file-level error.
- **Dry run** (`lib/import/dryRun.ts`, pure over rows the action fetched):
  per row, parsed values, zod errors, the resolved asset or `unresolved`,
  and `duplicate` when `(asset_id, trade_date, type, quantity, unit_price)`
  matches an existing transaction. Returns a `previewHash` of the parsed
  rows.
- **Commit** re-runs the dry run on the re-uploaded file and refuses if the
  hash differs, any row has an error, or any identifier is unresolved;
  duplicates are skipped unless their row index is in `forceInclude`; the
  insert is one bulk statement (atomic). Re-importing the same file is a
  no-op — the property test. Import writes `transactions` only.
- **Mapping is remembered** in `user_settings.csv_column_map` (decision
  24); it is a convenience and is not in the backup.

## Decisions to confirm before implementation

Each item changes a checked-in contract, a schema, or a behaviour a screen
will depend on. Once confirmed they are recorded under `MILESTONES.md` §3
as "Decisions taken", with rationale, numbered on from Milestone 2's 18.

19. **Milestone 3 pages are functional and unstyled.** Login, MFA
    challenge, assets, transactions (+ import), cash flows and settings
    exist as server-component pages with native forms and server actions —
    semantic HTML, no design tokens, no client components except the MFA
    enrolment widget. Milestone 5 applies SPEC §10 to all ten screens at
    once. Rationale: a server action with no form is untestable end to end
    and unusable by a person; styling twice is cheaper than building the
    flows blind, and the flows are what this milestone is measured on.
20. **Snapshot invalidation is a database trigger, not an application
    step.** Triggers on `transactions`, `prices` and
    `user_settings.base_currency` delete the user's snapshots from the
    touched date forward (all of them for a base change). Rationale: the
    invariant covers every write path including ones this milestone does
    not write (the nightly price cron, `restore_backup`), and a forgotten
    call cannot silently leave history stale. Cost: a row-level delete per
    written row, an index lookup on a personal ledger.
21. **The snapshot calendar is the union of the user's enabled packs'
    business days.** One row per asset per such day; weekends and shared
    closures are skipped, a day open in any held market is built.
    Rationale: SPEC §8 says "business day" without naming a calendar; the
    union is the set of days on which a valuation can change, and it keeps
    the TWR chain free of zero-return weekend sub-periods.
22. **`portfolio_snapshots` gains `price_date date`, `fx_date date` and
    `status text check (status in ('ok','carried_forward','stale'))`**
    (forward migration; amends decision 6, which named only the two dates).
    Rationale: decision 10 excludes stale rows from confident totals; a
    reader re-deriving staleness from `price_date` needs the pack window
    and calendar at read time, and a reader that forgets shows a stale
    value as confident — the exact §11 failure. Storing the kernel's own
    status removes that class of bug; the dates stay so a row explains
    itself.
23. **The CSV parser and writer are hand-written**, RFC 4180, ~100 lines
    with property tests, no dependency. The only new dependency this
    milestone adds is `@supabase/ssr` (pinned to the current release,
    `0.12.7`, with `@supabase/supabase-js` moved to `2.116.0`).
24. **The CSV column mapping is stored in `user_settings.csv_column_map
    jsonb null`** (same forward migration as decision 22) and is not part
    of the backup (`settings` stays the four keys of decision 18).
25. **Cash flows are entered in the base currency only.** The form offers
    no currency; the action writes `base_currency`. `cash_flows.currency`
    stays for the day a multi-currency ledger needs it, and the kernel
    already converts at the flow date (decision 16). Rationale: SPEC §8/§9
    define a cash flow as money the investor put in, in the currency the
    portfolio is measured in; a foreign-currency deposit is a Milestone 4+
    question with the UK pack.
26. **Base currency locks at the first transaction; the reset is explicit
    and one action.** `changeBaseCurrency` refuses with `base_locked` while
    any transaction exists unless `confirmReset: true`, in which case it
    updates the setting — the decision 20 trigger then drops every
    snapshot and the next run rebuilds history in the new base.
27. **An asset's identity is immutable once it has a transaction; an asset
    with transactions cannot be deleted.** `pack_id`, `instrument_kind`,
    `identifier` and `native_currency` are editable only while the asset
    has no rows referencing it; `name` and `metadata` always are. Delete
    refuses with `asset_has_transactions`. Rationale: identity is what
    prices are keyed on (`identifier` is the market ref) and what the
    valuation strategy hangs off; changing either under a position
    silently re-prices history. Cascading delete belongs behind Milestone
    5's type-to-confirm.
28. **Enabling a pack is allowed for draft packs, with a banner.** PACKS
    §12 says draft is never in the DEFAULT `enabled_packs`; the owner
    choosing it is informed consent. The settings action lists every
    registered pack with its status and refuses `unmaintained`. Rationale:
    both in-repo packs are draft until Milestone 5; the product is unusable
    otherwise.
29. **Enabling a pack triggers `runIngest({ kind: "new_packs" })` for it
    through `after()`; creating an asset triggers `runIngest({ kind:
    "assets" })` then `runSnapshots({ kind: "users" })` for that user;
    Refresh triggers `unpriced` + snapshots.** All three run after the
    response under the service role with the remaining route budget
    (decision 30) — "save first, fetch second, never coupled" (SPEC §9.4).
    A fetch failure is visible on the asset through `ingest_cursors`, never
    on the form.
30. **Server-action routes declare `maxDuration = 60`** like the cron
    routes, and the after-response jobs receive `ingestBudgetMs()` minus
    the time the action already spent. A rebuild that runs out resumes on
    the next trigger; nothing waits synchronously on a network.
31. **No browser end-to-end test runner in this milestone.** Proof is
    unit tests over the pure modules (schemas, CSV, dry run, snapshot
    algorithm with a fake store), the `dbtest` tier for RLS, triggers,
    RPCs and auth (sign-in, uniform failure, AAL levels, TOTP enrol and
    verify with an RFC 6238 generator written in the test), and `next
    build`. Rationale: a browser runner is a large dependency that mostly
    re-proves what the dbtest tier proves; Milestone 5's screens are the
    right moment to add one if the UX work needs it.

## Definition of done

- `proxy.ts`, `lib/supabase/{server,browser,paginate}.ts`,
  `lib/auth/session.ts`, `app/login/page.tsx`, `app/login/mfa/page.tsx`,
  `app/login/reset/page.tsx`, `app/(app)/layout.tsx` and the pages
  `/`, `/assets`, `/transactions`, `/transactions/import`, `/cash-flows`,
  `/settings` exist; every `(app)` page and action calls `requireUser()`.
- `lib/ledger/` holds `schemas.ts`, `rows.ts` (text-cast row readers),
  `assets.ts`, `transactions.ts`, `cashFlows.ts`, `prices.ts`,
  `settings.ts`, each an action module returning typed results; `lib/csv/`
  and `lib/import/` hold the parser/writer and the dry-run/commit planner;
  `lib/jobs/{ingest,snapshots}.ts` are the only after-response entry
  points and the only non-cron constructors of the service-role client.
- Forward migrations: `snapshot_invalidation` (decision 20),
  `snapshot_columns` (decision 22) and `csv_column_map` (decision 24) —
  one file, three sections, idempotent.
- `app/api/cron/snapshots/route.ts` runs `runSnapshots` for all users under
  the cron secret and returns counts only; `lib/cron/budget.test.ts`
  enforces its `maxDuration` literal like the prices route.
- Tests: unit for every pure module; `fast-check` properties for the CSV
  round trip and import idempotence; dbtests for the trigger family, the
  snapshot job against the BR golden portfolio (rows equal
  `expected.json`'s per-date values), RLS refusals across two users, and
  the auth flows above. `pnpm test:db` runs against the local stack with
  `[auth.email] enable_signup = true` (Milestone 2 correction 2).
- `README.md` documents the CSV format (SPEC §9.1 "and in README.md").
- `specs/SPEC.md` carries US-003 to US-008 with every AC ticked;
  `MILESTONES.md` §3 is complete with corrections; `CLAUDE.md` and
  `lib/*/README.md` describe the tree.
- `pnpm typecheck && pnpm lint && pnpm test && pnpm test:db && pnpm
  codeowners --check && pnpm build` pass; `pnpm release:check` fails only
  on the two draft packs and `specs/PERSONAS.md`.

## Non-goals

- No design system, analysis screens, status strip, first-run card,
  privacy mode, empty-state copy or accessibility pass (Milestone 5) — the
  pages here are scaffolding a person can use.
- No OAuth, no signup route, no "remember device", no email-link MFA
  recovery (SPEC §9.6).
- No cash flows in foreign currencies (decision 25), no multi-file or
  broker-specific import, no assets-in-bulk.
- No UK pack, no second FX series, no promotion of a pack to `supported`.
- No transaction `fx_rate` derivation from the series (display only; a
  Milestone 5 nicety).
- No tax or fiscal figure of any kind.

## Ordering constraints

- Sessions before everything: every later page calls `requireUser()`.
- The invalidation triggers land **before** any write flow, so no flow is
  ever merged with a hand-written invalidation call that the trigger later
  makes redundant.
- The snapshot job lands before the asset flow, because the asset flow's
  after-response chain ends in `runSnapshots`.
- CSV import lands after the asset and transaction flows: its preview
  creates assets through the asset action and its commit is a bulk
  transaction insert validated by the transaction schema.
- Settings last: it composes the pack-enable trigger, the base-currency
  reset, export/restore (Milestone 2's `lib/backup`) and MFA, each of which
  depends on an earlier phase.

## Phase 0 — Baseline, decisions, stories, dependencies

1. Record the confirmed decisions under `MILESTONES.md` §3.
2. Add `@supabase/ssr`; bump `@supabase/supabase-js`; `pnpm install`.
3. `eslint.config.mjs`: ban `getSession` everywhere; ban
   `@/lib/supabase/service` outside `app/api/cron/**` and `lib/jobs/**`;
   extend the `parseFloat`/`Number(` ban to `lib/ledger/**`, `lib/csv/**`,
   `lib/import/**`, `lib/jobs/**`.
4. Move `readAll` to `lib/supabase/paginate.ts`; `lib/packs/store.ts`
   imports it. No behaviour change; its tests move with it.
5. Fill `specs/SPEC.md` with the Milestone 3 stories and acceptance
   criteria, each citing the SPEC section it comes from:
   - **US-003 Sign in as the owner** (§9.6): password login, uniform
     failure, AAL2 challenge when enrolled, sign out, sign out everywhere,
     password change and reset.
   - **US-004 Keep the ledger** (§2, §9 screens 6–8, §11): create/edit/
     delete assets, transactions and cash flows with field-level
     validation, ownership enforced, base currency lock, identity
     immutability.
   - **US-005 Price what I hold** (§9.4, §2 prices): automatic fetch on
     asset creation, manual price entry that cron never overwrites,
     Refresh.
   - **US-006 Snapshots follow the ledger** (§8, §11, decision 6): the cron
     route, the marker, invalidation on every history-changing write,
     resumability, rows matching the golden portfolio.
   - **US-007 Import my history** (§9.1): mapping, dry run, unresolved
     identifiers, duplicates, all-or-nothing commit, idempotence.
   - **US-008 Own my data** (§12.3, §9.6): export JSON + CSV with
     `last_export_at`, restore into an empty account with warnings, delete
     everything, enable packs, theme and locale.

## Phase 1 — Sessions and login

- `lib/supabase/server.ts` (`createServerSupabase()` over `cookies()`),
  `lib/supabase/browser.ts`, `proxy.ts` with a matcher excluding
  `/_next`, `/api/cron` and static files.

### Grounding (2026-09-20) — status: merged

Corrections to the prose above, found while building:

1. **There is no browser client.** `mfa.enroll()` returns the QR as a data
   URI, so enrolment is a server action that renders it; `challenge` and
   `verify` are server actions too. Nothing in the browser ever talks to
   Supabase, which is what lets the session cookie be `httpOnly` as SPEC
   §9.6 requires — a browser client could not have read it. Decision 19's
   "one client component" exception is therefore unused.
2. **Password reset needs three things the plan did not name**:
   `NEXT_PUBLIC_SITE_URL` (the reset link's origin comes from configuration,
   never the Host header, which an attacker can set), a landing route
   `app/auth/callback/route.ts` that exchanges Supabase's one-time code for
   a session and continues only to a same-origin path, and
   `http://127.0.0.1:3000/**` in `supabase/config.toml`
   `additional_redirect_urls` so the local Auth accepts the callback.
3. The access decision is a pure module, `lib/auth/access.ts`
   (`resolveAccess`, `redirectFor`, `isPublicPath`), shared by the proxy and
   the DAL so the two can never disagree; `session.ts` adds only `cache`
   and `redirect`.
4. AC-003.5's "sign out everywhere" and AC-003.6's password change land in
   Phase 6 with the other Settings security actions, as the phase list
   already says.
- `lib/auth/session.ts`: `requireUser()`, `requireAal2()` (used by
  unenrol and password change), `currentAal()`.
- `app/login/page.tsx` + `actions.ts` (`signIn`), `app/login/mfa/page.tsx`
  (`challengeAndVerify`), `app/login/reset/page.tsx` (`requestReset`,
  `completeReset`), `app/(app)/layout.tsx` with a plain nav (the §9.2
  routes as links, sign out) and `app/(app)/page.tsx` replacing the
  scaffold home. `app/page.tsx`'s pack-registry proof moves to `/settings`.
- Tests: `lib/auth/session.test.ts` with a fake client for the three
  redirect outcomes; `lib/auth/auth.dbtest.ts` — sign in, wrong password
  and unknown email return byte-identical results, `getUser()` verifies,
  enrol a TOTP factor with an RFC 6238 generator (`node:crypto` HMAC-SHA1)
  and prove AAL rises to `aal2` after `verify`, and that an AAL1 session on
  an enrolled user is what `requireUser()` redirects.

## Phase 2 — Data access layer and ledger reads

- `lib/ledger/rows.ts`: readers that return the kernel's row shapes
  (`HoldingAsset` needs the registry to resolve `instrumentKind`;
  `LedgerTransaction`, `ExternalCashFlow`, `PriceObservation`,
  `SeriesObservation`) from text-cast, paginated selects; `readLedger(client,
  registry)` composes them into a `PortfolioInput` for the signed-in user.
- `lib/ledger/queries.ts`: the list reads the pages need (assets with their
  latest price and its source, transactions by page, cash flows) and the
  counts (`assetsUnpriced`, `assets`, `transactions`).
- Pages `/assets`, `/transactions`, `/cash-flows` render lists only (forms
  arrive in Phase 4) so the reads are exercised on real pages.
- Tests: `rows.test.ts` with recorded PostgREST shapes (numeric as text,
  embedded rows as object-or-array); a dbtest that seeds the golden
  portfolio for a throwaway user, reads it back through `readLedger` as
  that user (RLS), and reproduces `expected.json` through `runGolden` — the
  same proof the backup round trip gives, now through the live read path.

### Grounding (2026-09-20) — status: merged

1. **A Phase 2 migration, `ledger_reads`.** "Latest price per asset" is a
   `DISTINCT ON`, which PostgREST cannot express; reading every price row to
   reduce in the app would be the row dump the plan forbids. A view
   `asset_latest_prices WITH (security_invoker = true)` runs under the
   caller's RLS and casts `price::text`. SPEC §9.4's "unpriced — source:
   reason" needs `ingest_cursors.last_error` readable, so SELECT (only) is
   granted to `authenticated`; the initial migration's write revoke stands.
   Phase 3's migration is therefore a second file, not three sections of one.
2. **Every paginated read orders by its key before `.range()`.** An
   unordered offset page can overlap or skip between requests; the plan
   said "filters before range" and should have said "and an order".
   `lib/packs/store.ts` (Milestone 1) pages without an order — a follow-up,
   not this phase.
3. **`assetsUnpriced` is not a Phase 2 count.** Its only consumer is the
   Milestone 5 status strip and first-run card; `listAssets` already
   carries per-row unpriced state. It lands with that consumer.
4. `readLedger` reads series from the earliest trade date less 62 days
   (`SERIES_LOOKBACK_DAYS`, two monthly inflation prints) so an
   `index_plus_spread` lot's opening level is bracketed; the snapshot job
   narrows the window further (Phase 3).

## Phase 3 — Snapshot invalidation, snapshot job, cron route

- Migration `<ts>_snapshots_m3.sql`: (a) `price_date`, `fx_date`, `status`
  on `portfolio_snapshots` (decision 22); (b) `csv_column_map` on
  `user_settings` (decision 24); (c) `invalidate_snapshots()` trigger
  function and the three triggers (decision 20), `security definer` with
  `search_path = ''` because a client-driven write must be able to delete
  rows the client itself may not touch.
- `lib/jobs/snapshots.ts`: `SnapshotStore`, `runSnapshots`,
  `createSnapshotStore(client)`; `lib/jobs/ingest.ts` re-exporting the
  after-response wrapper around `runIngest` with the budget helper.
- `app/api/cron/snapshots/route.ts` replaces the 501 stub; `vercel.json`
  unchanged.
- Tests: algorithm tests with a fake store (marker from nothing / from a
  gap, union calendar, budget stop between days, per-day rows equal
  `valuePortfolio`); dbtests: the trigger family (insert/update/delete a
  transaction, a price, a base currency change — each deletes exactly the
  rows from the touched date forward and nothing of another user's), and
  the job over the golden portfolio producing per-date totals equal to
  `expected.json`'s `valuations`.

### Grounding (2026-09-20) — status: merged

1. **The series read has no end cap.** The prose said
   `[marker − 62 days, today]`; capped at today, the job's 02-10 total was
   off by exactly the un-interpolated IPCA because the golden fixture's
   02-28 anchor fell outside the window. Ingestion never writes a point
   dated after today, so the cap changed nothing in production and only
   made the job disagree with the golden runner on identical data. The
   window is `[marker − 62 days, ∞)`.
2. **Decision 21's "enabled packs" means holdable packs.** `global` is
   activated as `br`'s dependency and has a 7-day calendar; a literal union
   would make every day a trading day. `tradingCalendars` takes the packs
   with instruments — enabled or held — and the unit test pins Saturday and
   Carnival as non-trading days.
3. `runSnapshots` takes no `registry`: the store owns it (it resolves kinds
   when it reads a ledger). The after-response wrappers live in
   `lib/jobs/index.ts` (`ingestJob`, `snapshotsJob`, `priceThenSnapshot`,
   `remainingBudgetMs`), not a separate `ingest.ts`.
4. The user universe for the cron scope is `user_settings`: a user without
   a settings row has no base currency to value in. `earliestTradeDate`
   and `lastSnapshotDate` are two `limit(1)` reads per user, not a scan.

## Phase 4 — Asset, transaction, cash-flow and manual-price flows

- `lib/ledger/schemas.ts` (zod, decimal strings, sign-by-type), then
  `assets.ts`, `transactions.ts`, `cashFlows.ts`, `prices.ts` — each
  `create/update/delete` returning the typed result, revalidating by path.
  Asset create validates `metadata` with the pack's `metadataSchema` and
  the identifier per `IdentifierSpec`; then `after()` → `runIngest({ kind:
  "assets" })` → `runSnapshots({ kind: "users" })` (decisions 29, 30).
- Forms on the three pages and on an asset's row for a manual price.
- Tests: schema tables; action tests with a fake client for every reason
  code; dbtests: cross-user references refused by RLS/FK, manual price not
  overwritten by `commit_ingest_chunk` (already in the tier), identity
  immutability and delete refusal (decision 27), base lock (decision 26).

## Phase 5 — CSV import

- `lib/csv/{parse,write}.ts` with the round-trip property.
- `lib/import/{mapping,dryRun,commit}.ts` and the `/transactions/import`
  page: upload → (map headers, saved to `csv_column_map`) → preview with
  per-row status and inline asset creation for unresolved identifiers →
  commit with `forceInclude`.
- `README.md` CSV section; export's `transactions-YYYY-MM-DD.csv` uses the
  writer so the app's own export imports as a no-op.
- Tests: parser properties; dry-run tables (errors, unresolved, duplicate,
  forced); dbtest: commit is one statement (a constraint failure on row N
  writes nothing), re-import is a no-op, the after-response chain prices
  the assets the preview created.

## Phase 6 — Settings: security and your data

- `lib/ledger/settings.ts`: `changeBaseCurrency` (decision 26),
  `setEnabledPacks` (decision 28, `after()` → `new_packs`), `setTheme`,
  `setLocale`; `lib/auth/security.ts`: `changePassword`, `unenrolFactor`,
  `signOutEverywhere`; the MFA enrolment client component.
- Your data: `exportBackup` (calls `export_backup`, serialises with
  `lib/backup`, writes the CSV with `lib/csv`, stamps `last_export_at`);
  `restoreBackup` (parse → `planRestore` → show warnings → `restore_backup`);
  `deleteEverything` (type-to-confirm + fresh password via
  `signInWithPassword`, then `auth.admin.deleteUser` through `lib/jobs` —
  the one deliberately user-triggered service-role write, as SPEC §12.3
  specifies).
- Tests: action tests; dbtests for the lock/reset path (snapshots gone,
  setting changed), pack enable, `last_export_at` stamp, delete cascades.

## Phase 7 — Documentation and gates

- `lib/ledger/README.md`, `lib/jobs/README.md`, `lib/auth/README.md`
  (short: the trust rules above and the module map); `CLAUDE.md` current
  state and layout; `README.md` status and CSV section; `MILESTONES.md`
  §3 complete with corrections; `specs/SPEC.md` ACs ticked.
- Gates in order: `pnpm typecheck && pnpm lint && pnpm test && pnpm test:db
  && pnpm codeowners --check`, `pnpm exec tsx
  scripts/check-release-readiness.ts` (draft packs + PERSONAS only), `pnpm
  release:check` end to end.

## Suggested merge sequence for a solo maintainer

1. Decisions recorded; stories; dependencies; lint bans; `paginate.ts`.
2. Sessions, DAL, proxy, login/MFA/reset pages, app layout.
3. Text-cast readers, list pages, the RLS read-path golden proof.
4. Migration (columns, mapping, triggers); snapshot job; cron route.
5. Schemas and the four ledger action modules with forms.
6. CSV parser/writer; import page; README format.
7. Settings: packs, base currency, security, your data.
8. Documentation and final gates.

The triggers are deliberately early and the settings deliberately late:
the first makes every later write path correct by construction, the second
is the only phase that composes all the others.
