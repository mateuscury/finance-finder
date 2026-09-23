# Milestone 4 — spec gaps: plan and runbook, one session

For the worker who closes, in one execution session, what the Phase 5
review of 2026-09-23 found: decisions the tree made that `SPEC.md` never
recorded, and product holes the SPEC never contemplated. Plan and runbook
are one document because the work is one session: §2 is the _why_ (eleven
decisions to confirm), §3 the _what, in which order, and how you know it is
done_. Written 2026-09-23 from the tree at `fa022d0`.

Slots between Phase 5 and Phase 6 of `docs/milestone-4-execution.md` as
units `G-U1`…`G-U6`. `P6-U1` then depends on `G-U6`.

## 0. How to work this document

`docs/milestone-4-execution.md` §0 applies unchanged — the preamble checks
(§0.1), the per-unit loop (§0.2), the rules that never bend (§0.3), the
tracking (§0.5) and the naming (§0.6). Read it first, then this. Three
deltas:

- **The gate** for a unit that touches `supabase/migrations/**` or
  `lib/ledger/**` includes `pnpm test:db`; for `app/**`, `pnpm build`; for
  a unit that adds to `e2e/gate-gaps.spec.ts`, `pnpm test:e2e
e2e/gate-gaps.spec.ts`. `pnpm test:calc` whenever `lib/calc/**` changes.
- **Decisions 56–66 are confirmed by the maintainer's approval of this
  document.** G-U1 records them in `MILESTONES.md` §4; nothing below is
  open for interpretation except where a unit says "choose".
- **Screenshots** go to `docs/review/gaps/`, produced by
  `e2e/gate-gaps.spec.ts` (G-U3), the same way `e2e/gate.spec.ts` produced
  Phase 2's. P7-U1 retires that spec into the journeys.

The order is fixed: G-U1 → G-U2 → G-U3 → G-U4 → G-U5 → G-U6. G-U4 and
G-U5 do not depend on G-U2/G-U3 but are sequenced after them so a failed
kernel unit stops the session before any screen is touched.

## 1. Unit index

| Unit | Title                                                            | Depends on | Status      |
| ---- | ---------------------------------------------------------------- | ---------- | ----------- |
| G-U1 | The SPEC states what the tree decided; US-015/US-016; decisions  | P5-U3      | not started |
| G-U2 | Open cost in the kernel; the holdings model                      | G-U1       | not started |
| G-U3 | Assets shows what you hold; the asset page shows its lots        | G-U2       | not started |
| G-U4 | Transactions filters; the `oversell` write guard                 | G-U1       | not started |
| G-U5 | Liveness in the strip and Settings; `pack_in_use`; Refresh guard | G-U1       | not started |
| G-U6 | The runbook absorbs the gaps (P6–P8 amended); stories ticked     | G-U3–G-U5  | not started |

**Blocked:** (none yet)

## 2. Decisions to confirm before implementation

Numbered on from 55 (`MILESTONES.md` §4). Each either records a contract
the tree already has and the SPEC lacks (56, 57, 58 in part) or adds one
(58 in part, 59–66). Rationale here; G-U1 copies the bold sentence and one
line of why into `MILESTONES.md`.

56. **The analysis period vocabulary is `1m · ytd · 1y · all`.** Nominal
    start resolved to the latest snapshot date at or before it; `all`
    while the history is shorter than a year, else `1y`; a period with no
    snapshot at or before its start is not offered. This is
    `app/(app)/_models/period.ts` and US-010 AC-010.1 as built; SPEC §9
    screen 2 gains it. _Why:_ the root SPEC is the feature authority
    (`CLAUDE.md` precedence) and did not name a single period.
57. **Top movers are the five largest absolute base-currency changes
    between the last two snapshot dates, confident rows only.** A stale row
    on either date drops the asset. `_models/overview.ts` as built; SPEC §9
    screen 1 gains it.
58. **Positions are FIFO lots; a sell beyond the open position is refused
    at write, never absorbed.** The kernel already throws `oversell`
    (`lib/calc/positions.ts`), but nothing outside it handles the throw: a
    too-large sell is written (the schema checks the sign only) and every
    screen that values the ledger then fails to the generic error boundary
    while the snapshot job marks the user `error` nightly. Now: the form,
    the edit and the import commit compute `quantityAt` before writing and
    refuse with `oversell` on `quantity`; a ledger that still contains one
    (a restored file — `restore_backup` cannot run the kernel) shows the
    asset's row on Assets as a ledger error and every derived screen says
    so instead of failing. SPEC §6 and §11 gain both halves.
59. **Cost is trade cost before fees.** `openCost = Σ quantity × unitPrice`
    over the open lots, `averageCost = openCost / quantity`, unrealised =
    market value (native) − open cost, labelled _before fees_. Fees already
    count in MWR and Contribution's `netInvested`. _Why:_ a fee-capitalised
    average is Brazil's fiscal "preço médio" — the one number ARCHITECTURE
    §2 keeps out — and the `Lot` has no fee leg (allocating fees across a
    partially consumed lot is a kernel decision the golden fixture does not
    exercise). Position analytics are not fiscal reporting; ARCHITECTURE §2
    says so in one sentence.
60. **Assets is the positions screen.** No eleventh route: the list gains
    quantity, average cost, value in base and unrealised; the asset page
    gains the open lots. "Ten screens" stays true everywhere it is written.
    _Why:_ the §9.5 empty copy already says "Add what you hold"; the
    registry row is where a holding's numbers belong, and the nav's two
    groups stay as §9.2 drew them.
61. **A pack with held assets cannot be disabled** — `setEnabledPacks`
    refuses with `pack_in_use`. _Why:_ a disabled pack's kinds would stay
    valued (`readLedger` activates held packs regardless) while Settings
    claimed otherwise; the refusal makes the setting mean what it says.
62. **Refresh is debounced server-side on its own cookie; overlapping runs
    are safe by idempotence; no lease.** `refreshAction` schedules nothing
    while `REFRESHING_COOKIE` is fresh. Two overlapping jobs (a Refresh
    during the cron) only duplicate fetches under the same per-source rate
    limit: every write is an idempotent upsert keyed by date. _Why no
    lease:_ a lease row is a new user-data table (decision 52 forbids), a
    Postgres advisory lock cannot span PostgREST's per-request
    transactions, and a lease that outlives a crashed run would block the
    nightly cron.
63. **Liveness is derived from the data, never logged.** Two missed nightly
    price runs (`max(ingest_cursors.last_run_at)` over the user's activated
    sources, or the account's `created_at` when none) older than two
    trading days before the last trading day → a strip item; a source with
    `last_error` set → a strip item; a snapshot gap whose
    `last_snapshot_written_at` (new column on the `snapshot_markers` view,
    `max(created_at)`) is two trading days old → the rebuild item reads
    _stopped_, not _rebuilding_. Each links to Settings › **Instance**,
    which lists per source the last run and error, the snapshot marker and
    its write time. _Why:_ D-19 chose `console.log` over a runs table; with
    no error-reporting SaaS (§12) the app is the only channel, and a
    self-hosted cron that dies is the failure most likely to rot an instance
    silently.
64. **Transactions filters by asset, type and date range**, applied
    server-side before `.range()`; the pager preserves them; an invalid
    value is ignored field by field (a filter is navigation, not input);
    the filtered count is shown. `?asset=` both filters the list and
    preselects the form — recording a sell while seeing that asset's
    history is the better behaviour for Maturities' link.
65. **Nothing is pruned in v1; growth is visible.** Settings › Instance
    shows row counts (own tables exact through RLS; `series_points`
    `count: "estimated"`, labelled approximate). SPEC §8 states the
    arithmetic: per pack ≈ series × 252 rows a year; per user ≈ assets × 252
    prices and assets × 252 snapshot rows a year — a 20-asset, ten-year
    ledger is ≈ 100k rows, far inside a free tier.
66. **The root SPEC carries the accessibility floor (§10) and the
    performance budgets (§8); `specs/SPEC.md` never holds a decision the
    root lacks.** `CLAUDE.md`'s precedence table gains the line. _Why:_ the
    acceptance criteria that drove Phases 2–5 were written in `specs/`
    while the document that "wins" on features stayed silent.

## 3. Units

---

### G-U1 — The SPEC states what the tree decided

**Goal.** Every decision above is in the document that owns it before a
line of code depends on it.

**Read first.** `SPEC.md` §6, §8, §9 (intro through §9.5), §9.2, §9.4,
§10, §11; `specs/SPEC.md` US-004, US-009, US-013 and the change log;
`MILESTONES.md` §4 from "Decision taken 2026-09-21 (grounding Phase 5)"
to the end of "Advisories recorded"; `CLAUDE.md` "Document precedence";
`ARCHITECTURE.md` §2; `docs/milestone-4-plan.md` "Progress";
`docs/milestone-4-execution.md` §1.

**Steps.**

1. `SPEC.md` §6 "Positions": replace the one-line paragraph with — lots
   derived from the ledger in `(tradeDate, rank, id)` order, `buy <
dividend = interest = fee < sell`; a buy opens a lot, a sell consumes
   FIFO; a sell beyond the open position is `oversell`, refused at write
   by the form, the edit and the import (decision 58) — a ledger that
   contains one (a restored file) is shown, not computed; open cost and
   average cost per decision 59, _before fees_; fees are in `investedFlows`
   and MWR.
2. `SPEC.md` §9 screen list: screen 1 — top movers per decision 57;
   screen 2 — the period vocabulary per 56, shared with screens 4;
   screen 6 — "list + create/edit" becomes the positions description
   (quantity, average cost and open cost before fees, latest price with
   its state, value in base, unrealised gain with sign and arrow; an
   untraded asset shows "—"; an unpriced or stale one shows no
   unrealised figure, never a number off a stale price; the asset page
   lists the open lots); screen 7 — filters per 64; screen 8 — "in the
   base currency only (MILESTONES §2 decision 25); multi-currency flows
   are Milestone 5". Keep "Ten screens."
3. `SPEC.md` §9.2 "Status strip": after the three examples add the
   liveness items of decision 63 with their copy shape, and "liveness
   items link to Settings › Instance".
4. `SPEC.md` §9.4 "Refresh": append decision 62's two sentences
   (server-side debounce; overlapping runs safe by idempotence; no lease).
5. `SPEC.md` §9.5 table, Assets row: "Add what you hold." stays; add
   "an asset with no transactions shows quantity —".
6. `SPEC.md` §8: after "Triggers" add **Growth** (decision 65: the
   arithmetic, "nothing is pruned in v1", "counts in Settings › Instance")
   and **Budgets** (P6-U1's thresholds — `runSnapshots ≥ 50 days/s`, every
   page read p50 `< 500 ms` over a five-year, twenty-asset ledger,
   `parseCsv` `< 500 ms` for 20k rows — "measured numbers in
   `docs/performance-budgets.md`").
7. `SPEC.md` §10: add **Accessibility** — WCAG AA contrast in both themes
   (4.5:1 text, 3:1 large text and UI), visible focus on every control,
   `prefers-reduced-motion` stops chart animation, every control reachable
   by keyboard, no horizontal scroll at 400 px, the strip is `aria-live`,
   error copy names the field. (The walk itself stays P7-U2.)
8. `SPEC.md` §11: three bullets — **Pack disabled with holdings** (61);
   **A stale date is not a valuation point** (decision 53 as implemented:
   a date counts only when every asset with open lots has a confident
   row; the screen states the covered span and the days left out);
   **Oversell** (58).
9. `ARCHITECTURE.md` §2, the tax bullet: append one sentence — "Average
   cost, open cost and unrealised gain are position analytics and stay
   (SPEC §6); a fee-capitalised or lot-elected cost for a tax return is
   fiscal and does not."
10. `CLAUDE.md` "Document precedence": add "`specs/SPEC.md` acceptance
    criteria are derived from the root `SPEC.md`; a decision found only in
    `specs/` is a root-SPEC gap to fix, not a second authority (decision
    66)." "Current state": one sentence naming this runbook between Phase
    5 and Phase 6.
11. `specs/SPEC.md`: after US-014 add
    **US-015 "See what I hold"** — AC-015.1 `/assets` lists every asset
    with today's quantity from FIFO lots, average and open cost before
    fees, the latest price with its state, market value in base and
    unrealised gain (money + %); untraded → "—", unpriced or stale → no
    unrealised figure. AC-015.2 the table's confident total equals the
    Overview headline on the same data. AC-015.3 `/assets/[id]` lists the
    open lots (opened, quantity, unit price, cost) and the position
    totals. AC-015.4 every quantity, cost, value and gain is an `<Amount>`
    printed by `lib/format` from a decimal string. AC-015.5 `/transactions`
    filters by asset, type and date range server-side; paging keeps the
    filter; an invalid value is ignored; the filtered count is shown.
    AC-015.6 a sell beyond the open position is refused at write with
    `oversell` on `quantity` by the form, the edit and the import commit; a
    ledger that still contains one shows the asset's row as a ledger error
    and every derived screen says so instead of failing.
    **US-016 "Know my instance is alive"** — AC-016.1 two missed nightly
    price runs → the strip says "no price run since <date>" (silent for an
    account's first two trading days); `last_error` on a source → "source
    <id> failing: <reason>"; a snapshot gap with no write for two trading
    days → "history stopped at <date>". AC-016.2 each links to Settings ›
    Instance: per source last run and error, the snapshot marker and its
    write time, row counts (own tables exact, `series_points` estimated).
    AC-016.3 disabling a pack with held assets → `pack_in_use`. AC-016.4
    Refresh during a refresh schedules nothing; overlapping runs are
    idempotent. AC-016.5 nothing is pruned; SPEC §8 states the growth
    arithmetic; Settings shows the counts. AC-016.6 no value, URL or secret
    in any new log line or error message. Three scenarios each, in the
    house shape; priority Must Have; status "Planned (Milestone 4 gaps)".
    Change-log row.
12. `MILESTONES.md` §4: the bullet list gains "Close the spec gaps the
    Phase 5 review found — positions, filters, liveness, two guards
    (`docs/milestone-4-gaps.md`)"; a heading **Decisions taken 2026-09-23
    (spec gaps found by the Phase 5 review)** with 56–66, one bold
    sentence and one line of why each, from §2 above.
13. `docs/milestone-4-plan.md` Progress: a row "5b — Spec gaps: positions,
    filters, liveness, guards | — | not started".
    `docs/milestone-4-execution.md` §1: the six G rows after P5-U3
    (Status `not started`), and P6-U1's "Depends on" becomes `G-U6`.

**Tests.** `pnpm format:check` (Prettier owns the tables); `pnpm test`
(the copy and doc tests).

**Done when.** `grep -n '1m · ytd\|top movers are\|before fees\|pack_in_use\|Instance' SPEC.md`
hits §9, §6, §11 and §9.2; `grep -c '^5[6-9]\.\|^6[0-6]\.' MILESTONES.md`
prints 11; `tsx scripts/check-release-readiness.ts` lists the same two
draft packs as before and nothing new.

**Gate & QA.** `pnpm format:check && pnpm test`. `/qa-spec-fidelity SPEC.md
§6, §8–§11 against MILESTONES.md §4 decisions 56–66` (a document-to-document
check: every decision has a home in the SPEC, and nothing in the SPEC
contradicts a decision).

**Commit.** `Milestone 4 gaps: the SPEC states what the tree decided`

---

### G-U2 — Open cost in the kernel; the holdings model

**Goal.** Decision 59 as two pure functions with property tests, and the
view model the Assets screen will render, proven on the golden.

**Read first.** `lib/calc/positions.ts` (the `Lot`, `lotsAt`,
`lotQuantity`, `investedFlows`), `lib/calc/positions.test.ts` (the `txn`
helper and the fast-check style), `lib/calc/money.ts` (`Money.of`, `zero`,
`add`, `sub`, `scale`), `lib/calc/portfolio.ts` (`HoldingRow`,
`ExcludedHolding`, `PortfolioValuation`), `lib/calc/errors.ts`
(`KernelError`, `isKernelError`), `app/(app)/_models/overview.ts` and its
test (the golden-driven pattern), `app/(app)/_models/coverage.ts`
(`groupByAsset` + `quantityAt` per asset), `lib/ledger/queries.ts`
(`AssetListItem`), `lib/calc/README.md` "Positions and series",
`vitest.config.mts` (the `lib/calc` floors).

**Steps.**

1. `lib/calc/positions.ts`: `openCost(lots: readonly Lot[], currency:
string): Money` — Σ `quantity × unitPrice` as `Money` in `currency`
   (`Money.zero(currency)` for no lots; a lot in another currency throws
   `currency_mismatch` through `Money.add`, the existing contract);
   `averageCost(lots: readonly Lot[]): KDecimal | null` — `openCost /
lotQuantity`, `null` when the quantity is zero. Doc comments say _why_
   before fees (decision 59). `lib/calc/README.md` module map line.
2. `app/(app)/_models/holdings.ts`: `holdingsModel(input: { valuation:
PortfolioValuation | null; transactions: LedgerTransaction[]; assets:
AssetListItem[]; today: IsoDate })` → `{ rows: HoldingModelRow[];
totalBase: string | null; currency: string; outsideTotal: number }`.
   Row: `assetId`, `identifier`, `name`, `kindLabel`, `currency`,
   `quantity: string` (`"0"` for untraded), `averageCost: string | null`,
   `openCost: string | null`, `price: { native: string; date: IsoDate;
status: ValueStatusKind; sourceId: string | null } | null`,
   `marketValueNative: string | null`, `marketValueBase: string | null`,
   `unrealised: { delta: string; rate: string | null } | null` (only when
   the holding's status is `ok` or `carried_forward` — decision 10: a
   carried value is confident; a stale one is not), `ledgerError:
"oversell" | null`. Per asset: `lotsAt(group, today)` inside a
   `try`; `isKernelError(err) && err.code === "oversell"` → the row carries
   `ledgerError` and nothing else numeric; any other error rethrows. Value
   and status from `valuation.holdings` by asset id; an `excluded` holding
   is `price: null` with the excluded reason as `status: "unpriced"`.
   Order: confident base value descending, then stale, then unpriced, then
   untraded; ties by identifier. `totalBase` = the sum of `ok` +
   `carried_forward` base values; `outsideTotal` the count of stale +
   unpriced holdings with quantity > 0. Every figure a decimal string via
   `toDecimalString`; `KernelDecimal` for the ratios; no `Number(`.
3. `ReasonCode` (`lib/copy/types.ts`) gains `"oversell"`; both
   dictionaries' `status.reasons` gain the line ("sells exceed what was
   bought — fix the transactions" / the Portuguese). This is the only copy
   change in this unit.

**Tests.** `positions.test.ts`: (a) property — for any list of buys,
`openCost` equals Σ `quantity × unitPrice` computed independently in the
test; (b) hand example — buy 10 @ 100, buy 10 @ 120, sell 5 →
`averageCost` = `113.3333333333…` (the FIFO remainder 5 @ 100 + 10 @ 120)
and `openCost` = `1700`; (c) after a full sell `averageCost` is `null` and
`openCost` is zero; (d) a lot in another currency throws
`currency_mismatch`. `holdings.test.ts` on the golden (`goldenLedgerRead`,
`valuePortfolio` at `expected.asOf`): `totalBase` equals
`valuation.totalBase` as a string; for the golden's first FII, `openCost`
equals the fixture's buys summed by hand in the test with `KernelDecimal`
and `unrealised.delta` equals `marketValueNative − openCost`; an untraded
asset (append one to the read) renders quantity `"0"` and nulls; an
`oversell` ledger (append a sell of 10× the position) yields
`ledgerError: "oversell"` on that row and leaves every other row intact.

**Done when.** `pnpm test:calc` green with `lib/calc/**` branches ≥ 92 %
(`pnpm test:coverage`); the holdings test's total equals the kernel's.

**Gate & QA.** Gate + `test:calc` + `test:coverage`. `/qa-code-quality
lib/calc/positions.ts app/(app)/_models/holdings.ts`.

**Commit.** `Milestone 4 gaps: open cost in the kernel, the holdings model`

---

### G-U3 — Assets shows what you hold; the asset page shows its lots

**Goal.** Decision 60 on the screen, in both languages, at both widths,
with the total provably the Overview's.

**Read first.** `app/(app)/assets/page.tsx`, `assets/[id]/page.tsx`,
`app/(app)/page.tsx` (the `change` closure and the `readLedger(…,
{ prices: "latest" })` + `valuePortfolio` read), `_components/amount.tsx`,
`_components/value-status.tsx`, `lib/copy/types.ts` `screens.assets` and
`screens.overview` (reuse its "N outside the total" string — find its key),
`en.ts`/`pt-BR.ts` for both, `app/globals.css` (`table.stack`, `.num`,
`.figure`), `e2e/gate.spec.ts` and `e2e/helpers.ts`, `SPEC.md` §9 screen 6,
§9.5, §11 as rewritten in G-U1.

**Steps.**

1. `_components/change.tsx`: lift Overview's `change` closure into
   `<Change delta currency rate locale copy />` (arrow + `<Amount>` +
   optional percent, `--pos`/`--neg` by direction). Overview uses it; no
   visual change there.
2. `/assets`: read `listAssets` and `readLedger(client, PACKS, { prices:
"latest" })` in the same `Promise.all`; `valuePortfolio` at `todayIso()`
   when `read.assets.length > 0`; `holdingsModel(...)`. Columns: Asset ·
   Kind · Quantity · Avg cost · Price · Value · Unrealised · Actions —
   currency folds into the Avg cost and Price cells as `162,40 BRL`, the
   way Transactions prints it (the Currency column goes). Row states:
   untraded → "—" in the four figure cells; unpriced → today's
   `<ValueStatus unpriced>` + Retry + Enter a price in the Price cell, "—"
   in Value/Unrealised; stale → Value with the ⚠ mark and Unrealised "—";
   carried → Value with ↻ and Unrealised shown; `ledgerError` → the
   `status.reasons.oversell` line across the figure cells with a link to
   `/transactions?asset=<id>`. `<tfoot>`: the confident total in base
   (`formatMoney`) and, when `outsideTotal > 0`, the Overview's "N outside
   the total" line. Every figure in `<Amount>`.
3. `/assets/[id]`: a **Position** section between the form and Prices
   (`id="position"`): the asset's transactions (`TRANSACTION_SELECT`,
   `.eq("asset_id", id)`, paginated with `readAll`, `toTransaction`) →
   `lotsAt(txns, today)` in a `try`; a `table.stack` of open lots (Opened ·
   Quantity · Unit price · Cost) in FIFO order and a totals line (quantity,
   average cost, open cost, _before fees_); `oversell` → the reason line
   and the transactions link instead of the table; no transactions → one
   muted line.
4. Copy: `screens.assets.columns` becomes `{ asset, kind, quantity,
averageCost, price, value, unrealised, actions }` (the old `value: "Price"`
   key is renamed `price`); add `untraded`, `beforeFees`, `total`,
   `position: { title, help, columns: { opened, quantity, unitPrice, cost },
none, totals }`; both languages; the type first.
5. `e2e/gate-gaps.spec.ts` modeled on `gate.spec.ts`: one owner,
   `restoreGoldenWithSnapshots`, light theme; `/assets` and
   `/assets/<first golden asset id>` at 1280 and 400;
   `expectNoHorizontalOverflow`; screenshots to `docs/review/gaps/`; and
   the proof of AC-015.2 — read the Overview headline `<Amount>` text and
   the Assets `<tfoot>` total text and assert equality.
6. Every `valuePortfolio(` call site under `app/(app)` (grep) wraps the
   call: `oversell` → the page renders `copy.errors.ledger({ n })` ("N
   assets have sells beyond their buys — fix them on Assets", a link) in
   place of its figures; anything else rethrows to the boundary. Add
   `errors.ledger` to both dictionaries.

**Tests.** G-U2's model test carries the numbers; `pnpm build`; the
gate-gaps spec green; manual on the dev server: privacy mode masks
quantity, cost, value and unrealised; the P5-U2 literal-string grep on
`app/(app)/assets` finds nothing.

**Done when.** The gate-gaps assertion holds (Assets total = Overview
headline on the golden); both widths overflow-free; screenshots in
`docs/review/gaps/`.

**Gate & QA.** Gate + build + `pnpm test:e2e e2e/gate-gaps.spec.ts`.
`/qa-spec-fidelity app/(app)/assets against SPEC §9 screen 6, §9.5, §11 and
US-015 AC-015.1–AC-015.4, AC-015.6` · `/qa-code-quality app/(app)/assets
app/(app)/_components/change.tsx` · `/qa-ux /assets /assets/[id] against
specs/PERSONAS.md "Scenario 1: Evening check on the phone"`.

**Commit.** `Milestone 4 gaps: Assets shows what you hold — quantity, cost, value, unrealised`

---

### G-U4 — Transactions filters; the `oversell` write guard

**Goal.** Decision 64 on the screen and decision 58's write half in every
path that writes a transaction.

**Read first.** `lib/ledger/queries.ts` (`pageOf`, `listTransactions`),
`lib/ledger/queries.test.ts` (the fake client records `filters`),
`lib/ledger/schemas.ts`, `lib/ledger/schemas.test.ts`, `lib/ledger/transactions.ts` (`createTransaction`, `updateTransaction`) and `lib/ledger/writes.dbtest.ts`,
`app/(app)/transactions/import/actions.ts`, `lib/import/dryRun.ts` (`PreviewRow`, `ImportRow`) and `lib/import/commit.ts` (`planCommit`, `rows_have_errors`),
`app/(app)/transactions/page.tsx`, `_components/pager.tsx`,
`app/(app)/_lib/form.ts` (`first`, `fieldsFrom`), `lib/copy/types.ts`
`screens.transactions` and `screens.pager`, `lib/calc/positions.ts`
(`quantityAt`, `groupByAsset`).

**Steps.**

1. `lib/ledger/schemas.ts`: `TransactionFilterSchema` — `asset` (uuid),
   `type` (the five), `from`/`to` (ISO dates), all optional — and
   `parseTransactionFilter(params: Record<string, string | string[] |
undefined>): TransactionFilter` that keeps each valid field and drops
   the rest silently; drops `to` when `to < from`. Exported type
   `TransactionFilter`.
2. `lib/ledger/queries.ts`: `pageOf` gains `apply?: (q) => q` applied
   before `.order()` and `.range()` (the house rule); `listTransactions(
client, page = 1, filter: TransactionFilter = {})` applies
   `.eq("asset_id")`, `.eq("type")`, `.gte("trade_date")`,
   `.lte("trade_date")`. The count is the filtered count.
3. `_components/pager.tsx`: `Pager` gains `query?: Record<string,
string>`; links are built with `URLSearchParams` so every page link
   keeps the filter.
4. `/transactions`: `parseTransactionFilter(params)`; a `<form
method="get" className="row-form" aria-label={c.filter.label}>` above
   the table — asset `<select name="asset">` (an "all" option, then
   identifiers from `listAssets`), type `<select name="type">` ("all" +
   `c.types`), `from`/`to` `<input type="date">`, an Apply button, and a
   Clear link to `/transactions` shown only while a filter is active. While
   active: `c.filter.showing({ n: result.total })` above the table; zero
   rows → `c.filter.none` + Clear, not the §9.5 empty state (that stays for
   `result.total === 0 && !active`). `?asset=` keeps preselecting the
   form's asset and `type=sell` (decision 64: it now also filters). `Pager`
   receives the active filter as `query`.
5. **The write guard.** In the ledger's transaction create and update
   functions, before the write: read the asset's transactions
   (`TRANSACTION_SELECT`, `.eq("asset_id")`, paginated), substitute or
   append the candidate row, `quantityAt(rows, "9999-12-31")` inside a
   `try`; `oversell` → `fail("oversell", ["quantity"])`. `ActionReason`
   gains `oversell`; `copy.reasons.oversell` in both languages ("That sell
   is larger than the position on its date."). The import commit: after
   the planner resolves assets and before the all-or-nothing write, run the
   same check per asset over existing + planned rows; an oversell is a row error in the preview (`dryRun.ts` marks the `PreviewRow`; `planCommit` then refuses with `rows_have_errors`, as for any other row error) so the user sees which row
   before committing.
6. Copy: `screens.transactions.filter: { label, asset, type, from, to,
all, apply, clear, showing, none }` in both languages; the type first.

**Tests.** `queries.test.ts`: `listTransactions(client, 2, { type: "sell",
from, to })` records `[["type","eq","sell"],["trade_date","gte",from],
["trade_date","lte",to]]` and a range starting at 100; no filter records
none. `schemas.test.ts`: `parseTransactionFilter` drops a non-uuid asset,
an unknown type, an unparsable date and `to < from` (keeps `from`); keeps a
full valid set. `writes.dbtest.ts`: on the golden, a sell of 10× a
position's quantity returns `oversell` on `quantity` and writes nothing;
editing a buy's quantity below what later sells consume returns `oversell`;
a sell exactly equal to the position succeeds. `ledger.dbtest.ts`: `type:
"dividend"` returns exactly the fixture's dividend count; `asset` returns
only that asset's rows; user B's filtered read of user A's asset id returns
zero rows. An import-preview test in `app/(app)/transactions/import/
load.test.ts` (or the planner's test) for an oversell row marked as an
error. Extend `gate-gaps.spec.ts`: `/transactions?type=sell` at both
widths; after Apply the URL carries `type=`; Clear returns to the full
list. `pnpm build`.

**Done when.** Every filter is applied before `.range()` (read the diff);
no user-facing literal in `app/(app)/transactions`; the three dbtest cases
pass; the gate-gaps spec is green.

**Gate & QA.** Gate + `test:db` + build + `pnpm test:e2e
e2e/gate-gaps.spec.ts`. `/qa-spec-fidelity app/(app)/transactions
lib/ledger against SPEC §6, §9 screen 7, §11 and US-015 AC-015.5,
AC-015.6` · `/qa-code-quality lib/ledger/queries.ts lib/ledger/schemas.ts
app/(app)/transactions/page.tsx app/(app)/_components/pager.tsx` ·
`/qa-ux /transactions against specs/PERSONAS.md "Scenario 2: Import a
broker CSV after switching brokers"`.

**Commit.** `Milestone 4 gaps: Transactions filters; sells beyond the position are refused`

---

### G-U5 — Liveness in the strip and Settings; `pack_in_use`; Refresh guard

**Goal.** Decisions 61, 62, 63 and 65: the instance tells its owner when
its crons stopped, and two settings mean what they say.

**Read first.** `lib/ledger/status.ts`, `status.test.ts`,
`status.dbtest.ts`; `app/(app)/_components/status-strip.tsx`;
`lib/copy/types.ts` `strip`, `screens.settings.data`, `reasons`;
`en.ts`/`pt-BR.ts` for each; `app/(app)/settings/page.tsx` ("Your data");
`lib/ledger/settings.ts` (`setEnabledPacks`), `settings.test.ts`,
`settings.dbtest.ts`; `lib/ledger/result.ts`; `lib/ledger/queries.ts`
(`countLedger`); `app/(app)/_actions/refresh.ts`;
`lib/settings/preferences.ts` (`isRefreshing`, `REFRESHING_COOKIE`);
`supabase/migrations/20260921100000_snapshot_views.sql` (the view
pattern) and `20260920210000_ledger_reads.sql` (the `ingest_cursors`
select grant); `vercel.json` (21:30 and 23:00 UTC, Mon–Fri);
`lib/calc/calendar.ts` (`isBusinessDay`); `scripts/db-types.ts`.

**Steps.**

1. Migration `supabase/migrations/20260923100000_liveness_views.sql`
   (decision 52: a view body): `create or replace view
public.snapshot_markers` with the two existing columns plus
   `last_snapshot_written_at = (select max(p.created_at) …)`; update the
   comment; `grant select … to authenticated` again (idempotent). Apply
   with `supabase migration up --local`; `pnpm db:types`; commit the
   `lib/database.types.ts` diff.
2. `lib/ledger/status.ts`: `tradingDaysBack(calendars, date, n)` beside
   `lastTradingDay` (walk back `n` trading days). `LedgerStatus` gains
   `ingestStale: { lastRunAt: string | null; expectedBy: IsoDate } | null`
   and `failingSources: { sourceId: string; code: string; lastRunAt: string
| null }[]`; `rebuild` gains `stalled: boolean`. Rules (decision 63),
   all against `target = lastTradingDay(calendars, today)` and `limit =
tradingDaysBack(calendars, target, 2)`: read `ingest_cursors` for the
   sources of the user's activated packs (`resolveActivation`, as
   `disabledSources` already iterates) minus the disabled ones;
   `reference = max(last_run_at over those, settings.created_at)`;
   `ingestStale` when the user has at least one transaction and
   `reference.slice(0, 10) < limit`; `failingSources` = cursors with
   `last_error` set; `rebuild.stalled` when a gap exists and
   `last_snapshot_written_at` is null or its date `< limit`. Reads are
   through the user's client (`ingest_cursors` is granted to
   `authenticated`; `listAssets` reads it the same way).
3. Copy `strip`: `ingestStale({ lastRun: string | null })` — "no price run
   since <date> — check the crons" / "no price run yet — check the crons";
   `sourceFailing({ sourceId, reason })` — "source <id> failing: <reason>"
   (`reason` through `status.reasons`); `rebuildStopped({ through, lastRun
})` — "history stopped at <date>; last built <date> — check the crons".
   Both languages.
4. `status-strip.tsx`: `rebuild.stalled` picks `rebuildStopped` over
   `rebuilding`; then `ingestStale`, then one item per `failingSources`,
   before `disabledSources`; the three link to `/settings#instance`.
5. Settings › Your data gains **Instance** (`<section id="instance"
aria-labelledby="instance-h">`): a `<dl>` — last price run (formatted
   date-time or "never"); per source of the activated packs: last run,
   last error as `status.reasons`, or "disabled: <VARIABLE>"; snapshots
   through <date>, written <date-time>; then **Storage**: assets,
   transactions, cash flows, prices, snapshot rows (`countLedger` gains
   `prices` and `snapshots` — `head: true, count: "exact"` through RLS;
   `LedgerCounts` literals in `overview.test.ts` gain the two fields) and
   `series_points` with `count: "estimated"`, labelled "shared market data,
   approximate"; one sentence of copy with decision 65's arithmetic and
   "nothing is pruned; export a backup". Copy under
   `screens.settings.data.instance` in both languages. No link to a doc
   (P8-U2's `DEPLOY.md` will be named by G-U6 in the runbook; copy says
   "see the deploy runbook's cron section").
6. `lib/ledger/settings.ts setEnabledPacks`: `removed = [...before].filter(
id => !wanted.includes(id))`; when non-empty, `client.from("assets")
.select("*", { count: "exact", head: true }).in("pack_id", removed)`;
   count > 0 → `fail("pack_in_use", ["enabled_packs"])` before any write.
   `ActionReason` gains `pack_in_use`; `copy.reasons.pack_in_use` in both
   languages ("A pack with held assets stays enabled; delete or re-home
   those assets first."). The Settings `<Notice>` already maps reasons.
7. `refreshAction`: read the jar first; `isRefreshing(jar.get(
REFRESHING_COOKIE)?.value, Date.now())` → redirect without scheduling
   (the strip already says "fetching in the background"); one comment
   naming decision 62. The per-row Retry on Assets posts the same action
   and inherits the guard.

**Tests.** `status.test.ts` (fake client): (a) cursors two trading days
old with an account older than that → `ingestStale` set; (b) an account
created today with no cursor → not set; (c) a cursor with `last_error` →
`failingSources` names it with the code; (d) a gap with
`last_snapshot_written_at` three trading days old → `rebuild.stalled`;
(e) `tradingDaysBack` across a weekend and a B3 holiday. `status.dbtest.ts`:
set `last_error` on `br.brapi` under the admin client; the owner's
`readStatus` names it; restore the cursor after. `settings.test.ts`:
`pack_in_use` with a fake `assets` count of 1 and no write call recorded;
`settings.dbtest.ts`: disable `br` while a golden asset is held →
`pack_in_use` and `enabled_packs` unchanged. `queries.test.ts`:
`countLedger` returns five counts. `lib/settings/preferences.test.ts`
already proves `isRefreshing`; no new test for the action. `pnpm build`.

**Done when.** On the golden after `restoreGoldenWithSnapshots` the strip
shows no liveness item (the account is new, the snapshots just written);
after the dbtest sets a `last_error`, it shows one; `/settings#instance`
lists the golden's sources and counts; the P5-U2 literal grep on
`app/(app)/settings` and `_components/status-strip.tsx` finds nothing.

**Gate & QA.** Gate + `test:db` + build. `/qa-spec-fidelity
lib/ledger/status.ts lib/ledger/settings.ts app/(app)/settings
app/(app)/_actions/refresh.ts against SPEC §9.2, §9.4, §11 (as of G-U1) and
US-016 AC-016.1–AC-016.6` · `/qa-code-quality lib/ledger/status.ts
lib/ledger/settings.ts app/(app)/_actions/refresh.ts
app/(app)/settings/page.tsx` · `/qa-ux /settings against
specs/PERSONAS.md "Scenario 1: Evening check on the phone"` (the number
she trusts is only as fresh as the crons; the strip is where she learns
otherwise).

**Commit.** `Milestone 4 gaps: liveness in the strip and Settings; pack-in-use and Refresh guards`

---

### G-U6 — The runbook absorbs the gaps

**Goal.** Phases 6–8 measure, journey and document the new surface, and
the stories say what shipped.

**Read first.** `docs/milestone-4-execution.md` P6-U1, P7-U1, P7-U2,
P8-U2; `docs/milestone-4-plan.md` "Progress", "Phase 6", "Phase 7";
`specs/SPEC.md` US-015, US-016 and the change log; `README.md` (the
features paragraph and the privacy section); `e2e/gate-gaps.spec.ts`.

**Steps.**

1. P6-U1 step 2: add `holdingsModel` over the Assets read and
   `listTransactions` with a `type` filter to the timed set; note that the
   synthetic ledger's sells must stay within FIFO (an oversell throws at
   `lotsAt`).
2. P7-U1 step 2: `04-import-csv` gains "filter by `type=dividend` → the
   fixture's count"; `05-analysis` gains "the Assets total equals the
   Overview headline; the first asset page lists its lots"; a tenth
   journey `10-instance.spec.ts` — after restore, no liveness item; set
   `last_error` on `br.brapi` under admin → the strip names it and links
   to `/settings#instance`; disable `br` in Settings → the `pack_in_use`
   notice; a sell of 10× the position → `oversell` marked on `quantity`.
   The "nine files" become ten; `e2e/gate-gaps.spec.ts` is deleted in
   P7-U1 (its screenshots and its total assertion move into `05`).
3. P7-U2 step 1: the checklist names the eight-column Assets table at
   400 px and the filter form's labels.
4. P8-U2: `docs/DEPLOY.md` must carry a **Crons** section — the two
   schedules from `vercel.json`, how to see a run in Vercel's logs (the
   `console.log` summary of D-19), and what the strip says when they stop
   (decision 63) — the section the Settings copy refers to.
5. `specs/SPEC.md`: tick every AC of US-015 and US-016 delivered by
   G-U2–G-U5 (all of them; AC-016.6 by the reviewer's grep of the diff for
   values and URLs in log and error lines); statuses "Done (2026-09-23)";
   change-log row. `README.md`: one line naming positions (quantity, cost,
   unrealised) and the Instance block.
6. `docs/milestone-4-plan.md` Progress row 5b → `done` with the commit
   range `G-U1..G-U6`; `docs/milestone-4-execution.md` §1: every G row
   `done <sha>` (G-U1–G-U5 ticked in their own commits; this one ticks
   itself); `CLAUDE.md` "Current state": "next P6-U1".
7. Regenerate `docs/review/gaps/` once more (`pnpm test:e2e
e2e/gate-gaps.spec.ts`) so the review folder matches the merged tree, as
   the earlier phases did.

**Tests.** `pnpm format:check && pnpm test`.

**Done when.** Every G row is `done`; P6-U1 depends on `G-U6`;
`tsx scripts/check-release-readiness.ts` lists the two draft packs only;
`git status` clean after the commit.

**Gate & QA.** `pnpm format:check && pnpm test`. `/qa-spec-fidelity
specs/SPEC.md US-015 US-016 against the tree` (every ticked AC has the file
that satisfies it).

**Commit.** `Milestone 4 gaps: runbook amended for Phases 6–8 — gaps closed`

---

## 4. Hand-off

After G-U6 the milestone continues at P6-U1 exactly as
`docs/milestone-4-execution.md` says, with the amendments of G-U6 in
place. Nothing here changes Phases 8–9 beyond the `DEPLOY.md` section, and
nothing touches `packs/**`, `transactions`' or `portfolio_snapshots`'
schema, or a frozen migration. The two draft packs remain the only
release-gate blockers, as before this document.

What this session deliberately does not do, and where it lives instead:
multi-currency cash flows (Milestone 5, decision 25); pack-supplied field
labels per locale (D-29, Milestone 5); pruning market data (decision 65 —
revisit when a measured instance needs it); a runs table (D-19 — Vercel's
logs hold the counts and codes).
