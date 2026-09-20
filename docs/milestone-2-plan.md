# Milestone 2 — Financial kernel and recovery: implementation plan

Drafted 2026-09-06 from the tree as it stands after Milestone 1. `MILESTONES.md`
§2 is the scope authority. This document fixes the conventions the kernel will
compute with, lists the decisions that must be confirmed before code is written,
and defines the implementation and merge order. Every merge unit must leave
`pnpm test` green on `main`.

## Outcome

Milestone 2 ends with a pure financial kernel in `lib/calc/` that turns ledger
rows, prices and series into valuations, TWR, MWR, contribution, attribution and
real returns; a BR golden portfolio that the kernel reproduces to `1e-8`; and a
complete JSON backup that restores into an empty account and is proven
equivalent by an automated export→delete→restore test against a real Postgres.

It does **not** make either pack `supported`, add screens or login, wire the
snapshot cron, or make the product safe for real data. `pnpm release:check`
stays red on login, draft packs and `specs/` placeholders only.

## Why the conventions below are written down first

`PACKS.md` §11.5 requires `expected.json` to be stated independently of the
kernel. That is only possible if the formulas are fixed before either the
fixture or the code exists. Every convention in this section is therefore an
input to Phase 5, and changing one after Phase 5 means recomputing the fixture.
`SPEC.md` §4–§6 names the functions and their meaning; this section pins the
arithmetic where the spec leaves it open.

### Arithmetic

- All kernel arithmetic uses a **kernel-private `Decimal` constructor**,
  `Decimal.clone({ precision: 40, rounding: ROUND_HALF_EVEN })`, exported from
  `lib/calc/decimal.ts`. Never `Decimal.set` on the global class: a shared
  global config is an action at a distance on every other consumer.
- Input values arrive as decimal strings matching `DecimalStringSchema`
  (`packs/schema.ts`); anything else is an `invalid_decimal` error, never a
  coercion. Output crosses the kernel boundary as canonical decimal strings
  (no exponent, no trailing zeros) produced from `toFixed()`, never
  `toString()`, which switches to exponent form outside `toExpNeg/toExpPos`.
- `Money` is `{ amount: Decimal; currency }`. Addition and subtraction across
  currencies throw `currency_mismatch`. Money times a `Decimal` scalar is the
  only multiplication; two `Money` values are never multiplied.
- The database boundary rounds to 10 decimal places (`numeric(24,10)`) with
  `ROUND_HALF_EVEN`, in store code, never inside `lib/calc`. The golden gate
  compares unrounded kernel output to `expected.json` with an absolute
  tolerance of `1e-8` for values and rates alike.
- Kernel code may `import` only `decimal.js`, `zod`, `@/packs/types`,
  `@/packs/schema`, `@/packs/decimal-text` and relative `lib/calc` files.
  `@supabase/*`, `next/*`, `@/lib/packs` and `@/lib/supabase` are banned by
  lint, as are `parseFloat`, `Number(` and `Math.*` on values.

### Calendar and staleness

- `isBusinessDay(calendar, date)`: not in `calendar.weekend` and not in
  `calendar.holidays(year)`.
- `businessDaysBetween(calendar, from, to)` counts business days in the
  half-open interval `(from, to]`. `BUS/252` year fraction is that count / 252.
- `ACT/365` and `ACT/360` use calendar days in `(from, to]` over 365 or 360.
  `30/360` uses the US (NASD) convention.
- **Staleness window** for a pack: the longest run of consecutive closed days
  (weekend ∪ holidays) in the year of the valuation date, plus one day. For BR
  in 2026 that is Carnival (Sat 14 – Tue 17 Feb, four days) → 5 days. The
  window comes from the **asset's pack calendar** for both the price leg and
  the FX leg; the `global` calendar (7-day, no holidays) is never used for
  staleness, exactly as `packs/global/index.ts` says.
- An observation dated `d ≤ asOf` is *fresh* when `d = asOf`, *carried
  forward* when `asOf − d ≤ window`, and *stale* beyond that. Stale inputs
  produce no value: the holding is reported as stale with its last known value
  and date, and it is **excluded from the confident total** and listed
  separately (SPEC §11: never print a confident converted value off missing
  data).
- `nav_unit_price` tolerates two extra calendar days over the market window,
  because a NAV published D+1 is normal (PACKS §5).

### Positions

- Transactions are processed in `(trade_date, type rank, id)` order with rank
  `buy < dividend = interest = fee < sell`, so a same-day round trip never
  oversells.
- `buy` opens a lot `{ openedOn, quantity, unitPrice, currency, fees }`;
  `sell` consumes lots **FIFO**; `dividend`, `interest`, `fee` touch no lot.
  A sell that exceeds the open quantity throws `oversell` with the asset id
  and date; the kernel never carries a negative position.
- `quantityAt(asset, date)` is the sum of open lot quantities. Lots are kept
  because `accrual` values each lot from its own purchase date.
- **Data-entry convention for accrual instruments:** `quantity` is a count of
  units and `unit_price` is the price paid per unit, so principal =
  `quantity × unit_price`. A R$10,000 CDB is `quantity 1, unit_price 10000`
  or `quantity 10000, unit_price 1`; both value identically. This convention
  surfaces in the Milestone 3 forms and CSV docs.
- `netInvested(asset, (from, to])` for contribution: Σ buy cost
  (`quantity × unit_price + fees`) − Σ sell proceeds (`|quantity| × unit_price
  − fees`) − Σ dividend and interest amounts (`unit_price` holds the cash
  amount) + Σ fee transactions.

### Series kinds — one function per closed kind

| Kind | Function | Rule |
|---|---|---|
| `rate_daily` | compound over `(from, to]` | `Π (1 + r_d)` over business days (`BUS/252`) or calendar days (`ACT/*`). A missing day with no point is a **gap**: the consumer is `unpriced` with reason `series_gap`. Rates are never carried forward — that would fabricate an accrual. `30/360` with a daily series is `unsupported_convention`. |
| `rate_annual` | compound over `(from, to]` | `Π (1 + r_d)^(1/N)` with `N = 252` (`BUS/252`) or `365` (`ACT/365`). Same gap rule. |
| `index_level` | return over `[from, to]` | `level(to) / level(from) − 1`. Levels are prices: carried forward within the window, stale beyond. |
| `inflation_index` | `levelAt(date)` | `none`: last anchor `≤ date`. `linear_daily`: linear interpolation on calendar days between the two anchors bracketing `date`; anchors are month-end dated (`packs/br/README.md` quirk). Before the first anchor: `unpriced`. After the last anchor: held flat and marked carried forward for up to **62 calendar days** (two monthly prints), stale beyond. |
| `fx_rate` | `rateAt(date)` | quote units per base unit; carried forward within the asset's window, stale beyond. |
| `yield_curve` | `discountFactor(curveAt(date), tenorDays)` | linear interpolation of the rate across declared tenors, flat extrapolation beyond the ends, `DF = (1 + r)^(−tenorDays/365)`. The curve kind carries no day count, so ACT/365 annual compounding is the kernel default until a pack needs otherwise (that is a `SeriesKind` change and an API bump). |

### Valuation strategies — one module per closed kind

`valueHolding(asset, lots, market, date, ctx)` returns a discriminated result:
`ok` or `carried_forward` with `native: Money`, `unitValue`, `priceDate`;
`stale` with `lastKnown` and `priceDate`; or `unpriced` with a reason code.
Reason codes are fixed literals (`no_price`, `series_gap`, `no_fx_series`,
`before_first_anchor`, `indexation_not_supported`, …) so the UI and logs never
carry free text.

- **`market_price`**: `quantity × price`, price = latest observation `≤ date`
  within the window. A price whose currency differs from the asset's
  `native_currency` throws `currency_mismatch`.
- **`nav_unit_price`**: identical lookup with the wider NAV window.
- **`accrual`**: `Σ_lots quantity × unitPrice × factor(lot.openedOn, date)`.
  The factor covers business (or calendar) days in `(openedOn, date]`, so a
  deposit made today is worth exactly its principal today. Metadata `rate`
  is an **effective annual rate** in unit form (`"0.12"`), except in
  `percent_of_index` mode where it is the multiplier (`"1.10"`).

  | Mode | Factor |
  |---|---|
  | plain (no `index`) | `(1 + rate)^τ`, `τ` = year fraction by `dayCount` |
  | `percent_of_index` | `Π_d (1 + rate × i_d)` over the index's `rate_daily` points in `(openedOn, date]` — the CETIP/B3 convention for "110% do CDI". Requires a `rate_daily` index and `compounding: "daily"`; anything else is `unsupported_convention`. |
  | `index_plus_spread` | `level(date) / level(openedOn) × (1 + rate)^τ` with the level from an `inflation_index` or `index_level` series. |

  `compounding` is the **recognition granularity** of an effective annual
  rate, not a different rate quote: `daily` accrues smoothly every day;
  `monthly` recognises `(1 + rate)^(completedMonths/12)` and steps on each
  monthly anniversary of the lot; `annual` steps on each yearly anniversary.
  Terminal values agree at whole periods; only the path differs. This is what
  a UK fixed-rate bond paying annually looks like on a chart.
- **`curve_mark_to_market`**: cash flows from the PACKS §5 metadata shape.
  Face value 1 per unit; coupons every `12/frequency` months backward from
  `maturity`, each `rate/frequency`; principal at maturity; value =
  `Σ CF_i × DF(days_i)` using the curve observed at `date` (carried forward
  within the window). `indexation !== null` returns `unpriced` with
  `indexation_not_supported` in this milestone (see decision 7).

### FX

`resolveFx(series, native, base, date, window)`:

1. `native === base` → rate `1`, `derived: false`; stored `fx_rate` is `null`.
2. A direct `fx_rate` series with `base = native, quote = base` multiplies;
   one with `base = base, quote = native` divides.
3. Otherwise **triangulate through USD** with any two direct legs;
   `derived: true`.
4. Each leg is carried forward within the asset's window; the result is
   carried forward if any leg is, and stale if any leg is.
5. No usable series → `unpriced` with `no_fx_series`.

`value_base = value_native × rate`, `fx_date` is the date of the oldest leg
observation used.

### TWR

`twr(valuations, flows)` is currency-agnostic: valuations are `{ date, value }`
in base currency, flows are `{ date, amount }` in base currency, positive for
deposits. Both are supplied by the caller (snapshots in production, the golden
fixture in tests); `twr.ts` knows nothing about assets.

- Sub-periods are consecutive valuation dates. For each pair `(d₋₁, d)`:
  `r = V_d / (V_{d₋₁} + CF_d) − 1`, where `CF_d` is the sum of external flows
  attached to `d`. This is the **start-of-day** convention (decision 1).
- A flow dated on a non-valuation date attaches to the first valuation date
  `≥` its date. With daily snapshots that means a weekend deposit counts on
  Monday morning.
- A sub-period whose denominator is `≤ 0` is **skipped and reported**, never
  divided; the chain begins at the first valuation date with positive value.
  The result carries `{ twr, from, to, subPeriods, skipped }` so a ledger with
  no recorded deposits still yields a defined number and an explicit note of
  what was skipped (decision 2).
- Chaining property: `twr(a→c) = (1 + twr(a→b)) × (1 + twr(b→c)) − 1` whenever
  `b` is a valuation date.

### MWR / XIRR

`mwr({ from, to, startValue, flows, endValue })` builds the XIRR stream:
`−startValue` at `from` when positive; each external flow with its sign
**flipped** (a deposit is money the investor puts in, so it is negative);
`+endValue` at `to`. `xirr(stream)` solves `Σ CF_i / (1 + r)^(t_i)` with
`t_i = (date_i − date_0) / 365` (ACT/365, Excel-compatible).

- Newton from `0.1`, at most 50 iterations, stop when `|Δr| < 1e-14`.
- Fall back to bisection when Newton leaves `(−0.999999, 1e6)`, hits a flat
  derivative, or does not converge; the bracket is found by scanning
  `[−0.999999, 10]` for a sign change of NPV. No sign change → `null` with
  `no_root`. A stream without at least one negative and one positive amount
  → `null` with `insufficient_flows`.
- The result is annualised even for periods under a year, as XIRR is.

### Contribution

Over `[from, to]`, per asset `i`:
`gain_i = V_i(to) − V_i(from) − netInvested_i((from, to])`,
`D = V(from) + Σ external flows in (from, to]`, `c_i = gain_i / D`.
`Σ c_i` is exactly the period's simple return `(V(to) − V(from) − Σ
netInvested) / D` because every term shares `D`. When recorded cash flows match
trades this equals the flow-adjusted simple return; over a period with many
flows it is an approximation of TWR and is documented as such. `D ≤ 0` →
`null` with `zero_start_value`.

### Attribution

For an asset whose native currency differs from base, split `[from, to]` at the
asset's own transaction dates so quantity is constant in each sub-period. Per
sub-period `R_native = V_native(end) / V_native(start) − 1` and
`R_base = V_base(end) / V_base(start) − 1`; chain both geometrically; then
`R_fx = (1 + R_base) / (1 + R_native) − 1`. FX is the **residual**, so the
identity `(1 + R_base) = (1 + R_native)(1 + R_fx)` holds exactly by
construction and equals the pure FX return whenever quantity is constant.

### Real returns

`(1 + R_nominal) / (1 + π) − 1`, `π = level(to) / level(from) − 1` from a
`deflator`-role series via the `inflation_index` function above.

## Decisions to confirm before implementation

> **Confirmed 2026-09-20**, all ten on the recommendation below. The record
> of authority is `MILESTONES.md` §2 "Decisions taken"; this section is kept
> as the reasoning that was in front of the maintainer when choosing.

Each item changes a checked-in contract or the golden numbers. Items marked
**numbers** change `expected.json`; the rest change scope or schema. Once
confirmed they are recorded under `MILESTONES.md` §2 as "Decisions taken",
with rationale, as Milestone 1 did.

1. **Cash-flow timing — start of day** (numbers). A flow dated `D` is in the
   portfolio before `D`'s valuation: `r = V_D / (V_{D−1} + CF_D) − 1`. This is
   exactly right for the natural way a user without a cash ledger records a
   deposit (dated on the day it is invested) and only distorts the path, not
   the total, when cash idles. End-of-day would report a spurious +20% on a
   same-day deposit-and-buy. GIPS accepts either convention; what matters is
   picking one and stating it.
2. **A ledger with transactions but no cash flows** (numbers). Recommended:
   zero-start sub-periods are skipped and reported, so TWR is defined from the
   first valuation with positive value, and MWR is `null` with a reason when
   the stream has no negative amount. The alternative — inferring external
   flows from buy/sell transactions when the `cash_flows` table is empty —
   makes screen 8 optional but silently mixes two data models the moment a
   user records one real deposit. Recommended: skip-and-report; let the
   Milestone 5 UI nudge for the missing deposit.
3. **Export carries every `prices` row, not only manual ones.** SPEC §12.3
   lists `manual_prices`. But brapi's free plan cannot backfill beyond three
   months (`MILESTONES.md` §1 contract 3): FII history lost from the database
   is lost for good, so a restore from a manual-only backup would rebuild a
   portfolio whose snapshots cannot be reproduced. Recommended: a single
   `prices` array with `source_id` per row. `version` stays `1` because
   nothing has shipped; SPEC §12.3 is amended in the same merge unit.
4. **Restore semantics.** Restore only into an **empty** account (no assets,
   transactions, cash flows or prices), else refuse with a fixed reason —
   merge semantics are a different feature. Row ids are **preserved**
   (transactions and prices reference asset ids) and `user_id` is **always
   rewritten** to the restoring user; a file can never write another user's
   rows. `created_at` is preserved for equivalence. Unknown `pack_id` /
   `instrument_kind`, or metadata that fails the pack schema, **warn but
   restore**: the asset shows as unpriced, and data preservation beats
   validation in a recovery path. All-or-nothing in one database transaction.
5. **Two new BR instrument kinds so the golden portfolio covers all three
   accrual modes.** `packs/br/instruments.ts` expresses only
   `percent_of_index` (CDB, LCI/LCA both at % of CDI). Add
   `br.cdb_prefixado` (plain) and `br.cdb_ipca` (`index_plus_spread` on
   `br.ipca`), sharing `PrivateCreditMetadata`. This is a data-only pack
   change, gives two kernel modes a real consumer, and is cheap to reverse.
6. **Snapshot cron route ships in Milestone 3, not 2.** Milestone 2 ships the
   pure builder (`portfolio.ts` produces exactly the per-asset rows
   `portfolio_snapshots` stores). The route needs users with ledgers, and its
   other triggers (import commit, Refresh, first price) are Milestone 3
   surfaces. When it lands, `portfolio_snapshots` should gain nullable
   `price_date` and `fx_date` columns (forward migration) so a stale row is
   self-describing instead of a confident number.
7. **`curve_mark_to_market` with `indexation` is unsupported in Milestone 2.**
   No in-repo instrument uses the strategy since Tesouro moved to NAV
   (`MILESTONES.md` decision 2). The nominal bond path is implemented and
   property-tested against a synthetic curve because closed unions are
   implemented whole; the inflation-linked path needs an index base date the
   PACKS §5 shape does not carry, and is scheduled with the Milestone 4 gilt
   canary, where a real instrument can drive the shape.
8. **A real-database test tier.** `*.dbtest.ts` files run under
   `pnpm test:db` against the local Supabase stack and **fail loudly** when
   the stack is absent; `pnpm test` excludes them so CI without Docker stays
   meaningful, and `pnpm release:check` requires them. This tier also hosts
   the two Milestone 1 tests its plan §3.3 demanded and the tree does not
   contain: manual-price protection and `commit_ingest_chunk` rollback.
9. **`compounding` means recognition granularity of an effective annual
   rate** (numbers). See the accrual table. The alternative reading —
   `rate/m` nominal compounded `m` times — would make the BR manifest's
   `daily` produce `(1 + r/252)^n` for a prefixado CDB, which is not how a
   Brazilian "12% a.a." is quoted.
10. **Confident totals exclude stale and unpriced holdings** and report them
    alongside, rather than including a last-known value with a flag. This is
    SPEC §11 taken literally and is the number the snapshot builder writes.

## Definition of done

- `lib/calc/` contains `decimal.ts`, `money.ts`, `types.ts`, `dates.ts`,
  `calendar.ts`, `positions.ts`, `fx.ts`, `staleness.ts`, `series/` (one
  module per kind plus `index.ts`), `valuation/` (one module per strategy
  plus `index.ts`), `portfolio.ts`, `twr.ts`, `mwr.ts`, `contribution.ts`,
  `attribution.ts`, `real.ts`, `golden.ts`, `errors.ts`, `index.ts`. The
  release gate's five required kernel files are among them.
- Every module has unit tests and, where a property is stated above, a
  `fast-check` property test. `pnpm test:calc` runs without
  `--passWithNoTests`.
- Lint bans database, framework and float imports inside `lib/calc/`.
- `packs/br/fixtures/portfolio.json` covers every BR instrument kind
  (including the two from decision 5) and `expected.json` states valuation,
  TWR, MWR and contribution with a `$derivation` block of intermediate
  factors computed outside the kernel.
- `packs/conformance/fixtures.test.ts` no longer contains `expect.fail`; the
  kernel-reproduction test runs for every pack with instruments and matches
  to `1e-8`. `pnpm test:packs` reports **1 skip** (the golden fixture case
  for the instrument-less `global` pack).
- `lib/backup/` holds the versioned zod `BackupSchema`, a deterministic
  serializer, a parser, and a restore planner. Forward migrations add
  `export_backup()` and `restore_backup(jsonb)` as security-invoker RPCs
  that cast every `numeric` to text on the way out and back on the way in.
- `lib/backup/roundtrip.dbtest.ts` proves export→delete→restore→export
  equivalence modulo `exported_at`, and that the kernel valuation over the
  restored rows equals the golden expectation.
- The SPEC §12.3 "Release blocker" paragraph is replaced by a description of
  the restore path and its test, and `scripts/check-release-readiness.ts`
  requires the `dbtest` file and `lib/backup/` instead of grepping that
  sentence.
- `lib/calc/README.md` describes the real modules and conventions;
  `CLAUDE.md` current-state, `README.md` status, `MILESTONES.md` §2 are
  updated.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm test:db` and
  `pnpm codeowners --check` pass. `pnpm release:check` fails only on
  `app/login/page.tsx`, the two draft packs and `specs/` placeholders.

## Non-goals

- No screens, server actions, or login. No CSV export (it belongs with the
  CSV import flows in Milestone 3).
- No snapshot cron route, no snapshot invalidation triggers (Milestone 3).
- No UK pack, no `curve_mark_to_market` indexation, no second FX series.
- No export of `series_points` or `portfolio_snapshots`: the former is not
  user data, the latter is derived and rebuilt.
- No pack becomes `supported`. No schema change except the two RPCs.
- No tax or fiscal figure of any kind (ARCHITECTURE §2).

## Ordering constraints

- **Land Milestone 1 on `main` first.** It is committed as
  `89ba9d8 Milestone 1: trusted ingestion` on the branch
  `milestone-1-trusted-ingestion`, one commit ahead of `main`. Kernel work
  must start from that baseline on `main` so a bad merge unit is revertable
  on its own.
- The golden fixture (Phase 5) depends on every convention above and on the
  new instrument kinds (decision 5). Do not write `expected.json` before the
  decisions are confirmed, and never adjust it to match kernel output — a
  mismatch is a bug in one of the two, found by rederiving by hand.
- `fixtures.test.ts` unskips the reproduction case the moment
  `expected.valuation` is non-null. Land `lib/calc/golden.ts`, the fixture and
  the test change in **one merge unit**.
- Restore (Phase 6) reads money from Postgres for the first time in this
  project. PostgREST serialises `numeric` as a JSON **number**, which is a
  float by the time supabase-js hands it over. Every kernel-bound read must
  cast to text (`::text` in `select`, or a jsonb-building RPC). Establish the
  helper in Phase 6 and reuse it for every Milestone 3 read.

## Phase 0 — Baseline, harness, decisions

1. Fast-forward `main` to `milestone-1-trusted-ingestion` (and this plan).
2. Record the confirmed decisions under `MILESTONES.md` §2.
3. Add the `dbtest` tier: `vitest.db.config.ts` including `**/*.dbtest.ts`,
   `pnpm test:db`, exclusion from the default config, a shared
   `lib/testing/db.ts` that creates a throwaway auth user through the admin
   API and deletes it in `afterAll`. Missing `NEXT_PUBLIC_SUPABASE_URL` or
   `SUPABASE_SERVICE_ROLE_KEY` is a test failure with a message naming the
   variables, never a skip.
4. Backfill the two Milestone 1 integration tests into that tier:
   `commit_ingest_chunk` refuses to overwrite a `manual` price and rolls back
   data and watermarks together on a forced failure.
5. Extend `eslint.config.mjs` with the `lib/calc/**` import and syntax bans.
6. Fill `specs/SPEC.md` with the two Milestone 2 user stories (kernel
   accuracy against a golden portfolio; backup and restore equivalence) so the
   QA gates in `.claude/CLAUDE.md` have acceptance criteria to check against.
   The remaining template placeholders stay until Milestone 5.

## Phase 1 — Money, dates, calendar, kernel types

- `decimal.ts`: the private constructor and `toDecimalString(d)`.
- `money.ts`: `Money` with `parse`, `add`, `sub`, `scale`, `neg`, `isZero`,
  `compare`, `toString`; currency-mismatch throws.
- `types.ts`: kernel input rows — `LedgerTransaction`, `ExternalCashFlow`,
  `HoldingAsset` (with the resolved `InstrumentKind`), `PriceObservation`,
  `SeriesObservation` — all with decimal strings, plus `MarketData`, a
  read-only lookup built from arrays with per-id date-sorted indexes.
- `dates.ts`: ISO date arithmetic in UTC (`addDays`, `daysBetween`,
  `days30360`, month arithmetic for anniversaries). `lib/packs/ingest.ts` has
  its own `addDays`; leave it — `lib/calc` never imports `lib/packs`.
- `calendar.ts`: `isBusinessDay`, `businessDaysBetween`, `yearFraction`,
  `longestClosureRun`, `stalenessWindowDays`.
- `errors.ts`: `KernelError` with the closed code set.

Property tests: `Money.parse(x).toString() === canonical(x)`; add/sub are
inverse; scaling by `1` is identity; no `number` ever appears in a serialised
result; `businessDaysBetween` is additive over adjacent intervals and counts
BR 2026 Carnival correctly; `stalenessWindowDays(brCalendar, 2026) === 5`.

## Phase 2 — Positions, series, FX

- `positions.ts`: `lotsAt`, `quantityAt`, `netInvested`, the ordering rule,
  FIFO consumption and the `oversell` error.
- `series/`: `rate.ts` (`rate_daily`, `rate_annual`), `index-level.ts`,
  `inflation.ts`, `fx-rate.ts`, `yield-curve.ts`, `index.ts` dispatching on
  `SeriesKind`. Each returns a status-carrying result, never `NaN`.
- `fx.ts`: `resolveFx` with direct, inverted, triangulated and stale paths.

Property tests: positions are independent of input order; FIFO leaves
`Σ lots === Σ signed quantity`; oversell always throws; compounding a constant
daily rate over `n` business days equals `(1 + r)^n`; `percent_of_index` with
multiplier `1` equals the index; linear interpolation equals the anchors at
anchor dates and is monotone between them; direct and inverted FX series agree
to 1e-30; triangulation through consistent synthetic legs reproduces the direct
rate; carry-forward respects the window exactly at the boundary day.

## Phase 3 — Valuation, staleness, portfolio builder

- `staleness.ts`: `classify(observationDate, asOf, windowDays)`.
- `valuation/market-price.ts`, `nav-unit-price.ts`, `accrual.ts`,
  `curve-mtm.ts`, `index.ts` dispatching on `ValuationStrategy` and applying
  the reason codes above.
- `portfolio.ts`: `valuePortfolio(input, date)` → per-asset rows shaped like
  `portfolio_snapshots` (`quantity`, `priceNative`, `fxRate | null`,
  `baseCurrency`, `marketValueBase`, `carriedForward`, plus `priceDate`,
  `fxDate`, `status`), the confident `totalBase`, and the excluded list.

Tests: one table-driven suite per strategy with hand-computed expectations,
the three accrual modes × three compounding granularities × four day counts
(unsupported combinations must throw `unsupported_convention`), a synthetic
two-coupon bond against a flat curve where the closed form is known, NAV window
versus market window at the boundary, and a portfolio whose one stale holding
is excluded from the total and listed.

## Phase 4 — Performance math

- `twr.ts`, `mwr.ts`, `contribution.ts`, `attribution.ts`, `real.ts`.

Property tests: TWR with no flows equals `V_end / V_start − 1`; a zero flow is
a no-op; a deposit invested the same day at the same value leaves TWR
unchanged; the chaining identity; XIRR of a single deposit and terminal value
equals `(V/D)^(365/days) − 1` to 1e-12; XIRR is invariant to scaling every
amount and to shifting every date; the solution satisfies `|NPV| < 1e-10`;
contributions sum exactly to the simple return; the attribution identity holds
exactly and `R_fx` equals the FX series return when quantity is constant.

## Phase 5 — Golden portfolio

- `lib/calc/golden.ts`: `GoldenFixtureSchema` (zod) and
  `runGolden(fixture, registry)` returning valuation, TWR, MWR and
  contribution as decimal strings. This is what a pack contributor runs
  locally and what the conformance suite calls.
- Fixture shape: `baseCurrency`, `asOf`, `valuationDates`, `assets`
  (`id`, `instrumentKind`, `identifier`, `nativeCurrency`, `metadata`),
  `transactions`, `cashFlows`, `prices` keyed by identifier, `series` keyed by
  series id. Everything money-shaped is a decimal string.
- BR contents: one asset per instrument kind — `br.fii`, `br.tesouro_direto`,
  `br.cdb`, `br.lci_lca`, `br.cdb_prefixado`, `br.cdb_ipca` — about nine
  transactions including one sell and one dividend, three cash flows, six
  valuation dates spanning Carnival 2026, a constant synthetic CDI daily rate
  chosen so factors are exact, two IPCA month-end anchors, and one FII price
  deliberately missing on one valuation date to exercise carry-forward.
- `expected.json`: `asOf`, `valuation` (total and per asset, native and
  base), `twr`, `mwr`, `contribution`, `carriedForward`, and `$derivation`
  listing business-day counts, every accrual factor, each sub-period return
  and the XIRR stream. Derived by the checked-in
  `packs/br/fixtures/derive_expected.py` (standard-library `decimal` only,
  MILESTONES.md §2 decision 12); never copy kernel output into it.
- Replace `expect.fail` in `fixtures.test.ts` with the real comparison;
  condition the reproduction test on `pack.instruments.length > 0` so the
  suite ends at one skip.
- Update `packs/br/README.md` coverage table for the two new kinds and
  `pnpm codeowners`.

## Phase 6 — Backup and restore

- `lib/backup/schema.ts`: `BackupSchema` v1 —
  `{ version, exported_at, settings, assets, transactions, cash_flows,
  prices }` with decimal strings and ISO dates; `parseBackup` rejects unknown
  versions with a fixed reason.
- `lib/backup/serialize.ts`: deterministic output — rows sorted by stable
  keys, fixed key order, canonical decimals — so two exports of the same data
  are byte-identical except `exported_at`.
- `lib/backup/restore.ts`: pure planner — preconditions (empty account,
  version), warnings (unknown kinds, metadata failing the pack schema), and
  the row set with `user_id` rewritten.
- Forward migration `export_backup()` and `restore_backup(jsonb)`, both with
  an explicit `search_path`, execute revoked from `public`/`anon` and granted
  to `authenticated` (and usable by the service role in tests).
  `export_backup` is `security invoker` (RLS scopes it to the caller) and
  builds jsonb with every `numeric` cast to text. `restore_backup` is
  **`security definer`** (MILESTONES.md §2 decision 11): the `prices` insert
  policy admits only `source_id = 'manual'` from a client, so an invoker
  function could not restore the ingested rows decision 3 exports. Being the
  trust boundary, its body must itself (a) refuse a non-empty account,
  (b) verify every transaction, cash flow and price references an asset in
  the restored set, and (c) write `auth.uid()` as every row's `user_id`. It
  inserts in dependency order inside one transaction and casts back with
  `::numeric`. Neither function touches `series_points`, `ingest_*` or
  `portfolio_snapshots`.
- `lib/backup/roundtrip.dbtest.ts`: seed the golden portfolio for a throwaway
  user through the service role → `export_backup` → delete the auth user and
  verify cascades emptied every user table → recreate the user →
  `restore_backup` → `export_backup` → deep-equal modulo `exported_at`; then
  run `valuePortfolio` over the restored rows and compare with
  `expected.json`. Two refusal cases in the same file: a non-empty account,
  and a file whose price rows name an asset id owned by a second throwaway
  user (nothing written in either).
- Property test: `parseBackup(serialize(x))` deep-equals `x` over
  `fast-check`-generated ledgers.
- Amend SPEC §12.3 and `scripts/check-release-readiness.ts` as in the
  Definition of done. `last_export_at` stamping is a one-line server action
  in Milestone 3; the RPC takes no such side effect.

## Phase 7 — Documentation and gates

- Rewrite `lib/calc/README.md` from "planned" to the module map, the
  conventions section above (or a pointer to this plan), the reason-code list
  and the import rules.
- Update `CLAUDE.md` current state, `README.md` status, `MILESTONES.md` §2
  (mark complete, list any contract corrections found while implementing).
- Run `pnpm typecheck && pnpm lint && pnpm test && pnpm test:db &&
  pnpm codeowners --check`, then
  `pnpm exec tsx scripts/check-release-readiness.ts` and compare the blocker
  list with the Definition of done before running `pnpm release:check`.

## Suggested merge sequence for a solo maintainer

1. Milestone 1 commit; decisions recorded; `dbtest` tier with the two
   backfilled Milestone 1 tests; lint rules; `specs/SPEC.md` stories.
2. Decimal, money, dates, calendar, types, errors.
3. Positions.
4. Series kinds and FX.
5. Staleness, the four valuation modules, portfolio builder.
6. TWR, MWR, contribution, attribution, real.
7. Two new BR instrument kinds + golden fixture + `golden.ts` + conformance
   wiring (one merge unit).
8. Backup schema, serializer, planner, RPC migration, round-trip test, SPEC
   and release-gate edits (one merge unit).
9. Documentation and final gates.

Positions come before series because accrual valuation is lot-based and the
lot model must be settled before any accrual test is written. The golden
fixture is deliberately late: it is the one artefact that must not be edited to
fit the code, so it is written once, against confirmed conventions, when every
module it exercises already exists.
