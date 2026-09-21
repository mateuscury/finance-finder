# lib/calc — kernel math

Pure functions only. Owned by the kernel; packs never import from here
(enforced by lint and the conformance dependency check, PACKS.md §11.7), and
this directory never imports a database, a framework, the pack runtime or a
specific pack (enforced by `eslint.config.mjs`). Conventions every number is
computed under: `docs/milestone-2-plan.md`; decisions: `MILESTONES.md` §2.

## Rules

- All arithmetic is the kernel-private `KernelDecimal` (precision 40,
  `ROUND_HALF_EVEN`). Values enter as decimal strings (`parseDecimal`,
  `invalid_decimal` otherwise) and leave as canonical decimal strings
  (`toDecimalString`: no exponent, no trailing zeros, no `-0`). No
  `parseFloat`, `Number(`, `Math.*` or `Decimal.set` in kernel source.
- All series rates arrive in unit form (`"0.12"` means 12%). Yield-curve
  input is grouped by `(series_id, date)` with one positive `tenor_days`
  point per manifest tenor. Normalisation belongs at the pack boundary.
- A `KernelError` is a contract violation (closed code set in `errors.ts`).
  Missing or stale data is never an error: it is a status on the result
  (`carried_forward`, `stale` with the last known value, `unpriced` with a
  reason) so a screen can show it. Messages carry ids, dates and codes —
  never a value.
- Periods are half-open `(from, to]` (`inWindow`); business days are counted
  the same way.

## Module map

### Foundations

- `decimal.ts` — `KernelDecimal`, `ZERO`, `ONE`, `parseDecimal`,
  `toDecimalString`, `isDecimalString`.
- `errors.ts` — `KernelError` with the closed `KernelErrorCode` set.
- `money.ts` — immutable `Money` (`amount`, `currency`); `parse` from a
  decimal string, `of` from a Decimal; `add`/`sub`/`compare` throw
  `currency_mismatch` across currencies; `scale` by a Decimal is the only
  multiplication; `toString()` is the amount alone, `toJSON()` both fields.
- `dates.ts` — ISO "YYYY-MM-DD" arithmetic in UTC: `addDays`,
  `daysBetween`, `compareDates`, `addMonths` (end-of-month clamp),
  `completedMonths` (anniversaries), `days30360` (US/NASD), `dayOfWeek`,
  `yearOf`, `inWindow`.
- `calendar.ts` — over a pack `MarketCalendar`: `isBusinessDay`,
  `businessDaysBetween` on `(from, to]` (signed), `yearFraction` per
  `DayCount`, `longestClosureRun`, `stalenessWindowDays` (the longest closure
  touching the year + 1; BR 2026 = 5).
- `types.ts` — kernel input rows (`LedgerTransaction`, `ExternalCashFlow`,
  `HoldingAsset`, `PriceObservation`, `SeriesObservation`) with decimal
  strings, and `buildMarketData` — a validated, date-indexed read-only lookup
  with binary-search "latest at or before".
- `staleness.ts` — `classify(observedOn, asOf, windowDays)` → fresh /
  carried_forward / stale; the shared `Observed<T>` result shape; the closed
  `UnpricedReason` set; `worseOf` over `ValueStatus`.

### Positions and series

- `positions.ts` — `sortLedger` (`(tradeDate, rank, id)`, rank
  `buy < dividend = interest = fee < sell`), `lotsAt` (FIFO, `oversell`
  throws), `lotQuantity`, `quantityAt`, `investedFlows` (one signed cash
  effect per transaction in `(from, to]`) and `netInvested`, their sum in one
  currency, `groupByAsset`.
- `series/` — one function per closed `SeriesKind`; every result is a
  status-carrying union, never `NaN`:
  - `rate.ts` — `compoundRate` for `rate_daily` (Π(1 + m·rᵈ)) and
    `rate_annual` (Π(1 + m·rᵈ)^(1/N)); a missing day is `series_gap`, rates
    are never carried forward; `30/360` and `rate_annual` on `ACT/360` are
    `unsupported_convention`.
  - `index-level.ts` — `levelAt`, `indexReturn` (worse leg's status wins).
  - `inflation.ts` — `inflationLevelAt`: `none` steps, `linear_daily`
    interpolates on calendar days; `before_first_anchor`; flat for 62 days
    after the last anchor, then stale.
  - `fx-rate.ts` — `fxRateAt`.
  - `yield-curve.ts` — `curveAt`, `rateAtTenor` (linear, flat beyond the
    ends), `discountFactor = (1 + r)^(−t/365)`.
- `fx.ts` — `resolveFx`: same currency → 1; direct multiplies, inverted
  divides; else USD triangulation (`derived: true`); carried forward if any
  leg is, stale if any leg is; `fxDate` is the oldest leg; `no_fx_series`.

### Valuation

- `valuation/` — one module per closed `ValuationStrategy`, each returning a
  `HoldingValue` (`ok` / `carried_forward` with the native `Money`,
  `unitValue` and `priceDate`; `stale` with `lastKnown`; `unpriced` with a
  reason). `valueHolding(asset, lots, asOf, ctx)` in `index.ts` dispatches;
  `ValuationContext` carries `market`, the ASSET's pack `calendar`, its
  `windowDays` and the `series` in scope.
  - `market-price.ts` — `quantity × latest price ≤ asOf` within the window;
    a price in another currency is `currency_mismatch`.
  - `nav-unit-price.ts` — the same lookup with `NAV_EXTRA_DAYS = 2` more.
  - `accrual.ts` — `Σ_lots quantity × unitPrice × factor(openedOn, asOf)`;
    `rate` is an effective annual rate (or the multiplier in
    `percent_of_index`); `compounding` is the recognition granularity
    (decision 9). `maturity` is never read (decision 14). Metadata is read
    through `AccrualMetadataSchema = { rate }`; failure is `unpriced` with
    `invalid_metadata`. Support matrix (decision 13); every other cell throws
    `unsupported_convention`:

    | mode                | `daily`                                                                                                     | `monthly` / `annual`                   |
    | ------------------- | ----------------------------------------------------------------------------------------------------------- | -------------------------------------- |
    | plain               | `(1+r)^yearFraction(dayCount)`                                                                              | `(1+r)^(months/12)`, `dayCount` unused |
    | `percent_of_index`  | `Π(1 + r·i_d)` via `compoundRate`; `rate_daily`/`rate_annual` index whose day count equals the convention's | —                                      |
    | `index_plus_spread` | `level(asOf)/level(openedOn) × (1+r)^yearFraction`                                                          | level ratio × `(1+r)^(months/12)`      |

  - `curve-mtm.ts` — `Σ CF × discountFactor` off `curveAt`; `bondCashFlows`
    counts coupons back from `maturity` (each computed from maturity, never
    chained); flows dated ≥ asOf are included with `DF(0) = 1`; past
    maturity is `matured`; `indexation` is `indexation_not_supported`
    (decision 7).
- `portfolio.ts` — `valuePortfolio(input, asOf)` → the rows
  `portfolio_snapshots` stores (decision 17): a `HoldingRow` per asset with
  open lots whose price AND FX legs have a value, `status` the worse leg,
  `carriedForward` whenever not built on fresh inputs; `totalBase` over
  `ok` + `carried_forward`; `excluded` lists `stale` rows with their
  last-known base value and `unpriced` assets with the reason. Also
  `stalenessWindowFor(input, packId, date)` and `toBase(input, money, date,
packId)` — the one converter every base-currency figure goes through
  (decision 15). `PortfolioInput.calendars` is a pack-id → calendar map the
  caller builds: the kernel never imports the registry.

### Performance

Every function here consumes valuations and flows already in BASE currency
and never looks up a price itself.

- `twr.ts` — `twr(valuations, flows)` chains `r = V_d / (V_{d−1} + CF_d) − 1`
  over consecutive valuation dates: START-OF-DAY flows (decision 1). A flow on
  a non-valuation date attaches to the next valuation date; flows on or before
  the first date are part of `V₀`; flows after the last date are `ignored`
  (decision 16). A sub-period with a non-positive denominator is `skipped`
  and reported, never divided (decision 2); `twr` is null only when nothing
  survives.
- `mwr.ts` — `xirr(stream)` solves `Σ CF_i (1 + r)^(−t_i) = 0`, `t_i` in
  ACT/365 years from the earliest date: Newton from 0.1 (≤ 50 iterations,
  `|Δr| < 1e-20`), bisection to a `1e-30` bracket over a sign change scanned
  in `[−0.999999, 10]` when Newton leaves `(−0.999999, 1e6)`, meets a flat
  derivative or fails to converge. `null` with `insufficient_flows` (no
  negative and positive amount, or every flow on one date) or `no_root`. The guarantee is that the root
  lies within ±1e-12 of the rate — an absolute NPV bound is meaningless near
  a total loss, where `|NPV′|` exceeds 1e21. `mwr({ from, to, startValue,
flows, endValue })` builds the stream: `−startValue` when positive, flows
  in `(from, to]` negated, `+endValue`; flows after `to` are `ignored`.
- `contribution.ts` — `gain_i = V_i(to) − V_i(from) − netInvested_i`,
  `D = V(from) + Σ flows in (from, to]`, `c_i = gain_i / D`, so `Σ c_i` is
  exactly the simple return. `netInvested_i` is rebuilt in base by converting
  each `investedFlows` entry with `toBase` at its own date (decision 15). An
  asset `stale` or `unpriced` at either end, or with a transaction that has no
  FX, is null with the reason and `partial` is set; `D ≤ 0` is
  `zero_start_value` for every asset.
- `attribution.ts` — one holding, `[from, to]` split at its own transaction
  dates, each sub-period valued at both ends with the lots open at its start;
  `R_native` and `R_base` chained, `R_fx = (1 + R_base) / (1 + R_native) − 1`
  as the residual. Base-currency holdings have `R_fx = 0` exactly; a `stale`
  or `unpriced` boundary is null with the reason; never held is
  `no_position`.
- `benchmark.ts` — `seriesReturn(descriptor, market, from, to, { calendar,
windowDays })` (Milestone 4 decision 37): one function over the closed
  `SeriesKind` union — `index_level` → `indexReturn`; `rate_daily` /
  `rate_annual` → `compoundRate` factor − 1 on the pack calendar;
  `inflation_index` → interpolated level ratio − 1; `fx_rate` → rate ratio −
  1; `yield_curve` → `unpriced` with `not_a_return_series`. Status is the
  worse leg. This is what a pack's `benchmark` role plots.
- `real.ts` — `realReturn(nominal, market, deflator, from, to)` =
  `(1 + R) / (level(to) / level(from)) − 1` through `inflationLevelAt`;
  status the worse leg.

### The golden gate

- `golden.ts` — `GoldenFixtureSchema` (the shape of a pack's
  `fixtures/portfolio.json`), `runGolden(fixture, packs)` → valuation at
  `asOf`, the confident total on every valuation date, which assets were
  carried forward when, TWR, MWR and contribution — every figure a canonical
  decimal string — and `compareGolden(actual, expected)`, which walks
  `expected.json` (keys starting with `$` are annotations) and reports every
  leaf outside `GOLDEN_TOLERANCE = 1e-8`. This is the ONE place the kernel
  meets a pack manifest: the caller passes the packs in. The conformance
  suite runs it for every pack with instruments; `expected.json` is derived
  by the pack's checked-in script and never edited to match this output.

## Reason codes

`UnpricedReason` (closed; `staleness.ts`): `no_observation`, `series_gap`,
`before_first_anchor`, `no_fx_series`, `no_price`,
`indexation_not_supported`, `invalid_metadata`, `matured`,
`not_a_return_series`. The performance
modules add `stale`, `zero_start_value` (contribution) and `no_position`
(attribution) to their own null reasons.

## Tests

`pnpm test:calc` runs only this directory: hand-computed cases per module
and the `fast-check` properties the plan names for each phase. It is the
project's most important suite.
