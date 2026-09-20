# lib/calc — kernel math

Pure functions only. Owned by the kernel; packs never import from here
(enforced by lint and the conformance dependency check, PACKS.md §11.7), and
this directory never imports a database, a framework, the pack runtime or a
specific pack (enforced by `eslint.config.mjs`). Conventions every number is
computed under: `docs/milestone-2-plan.md`; decisions: `MILESTONES.md` §2.

## Modules (Milestone 2 Phase 1 — present)

- `decimal.ts` — the kernel-private `KernelDecimal` clone (precision 40,
  `ROUND_HALF_EVEN`), `parseDecimal` (strict, `invalid_decimal` otherwise),
  `toDecimalString` (canonical: no exponent, no trailing zeros, no `-0`).
- `errors.ts` — `KernelError` with the closed `KernelErrorCode` set. Errors
  are contract violations; missing or stale data is a result status, never
  an error. Messages carry ids and dates, never values.
- `money.ts` — immutable `Money` (`amount: KernelDecimal`, `currency`);
  `add`/`sub`/`compare` throw `currency_mismatch` across currencies; `scale`
  by a Decimal is the only multiplication.
- `dates.ts` — ISO "YYYY-MM-DD" arithmetic in UTC: `addDays`,
  `daysBetween`, `addMonths` (end-of-month clamp), `completedMonths`
  (anniversaries), `days30360` (US/NASD), `dayOfWeek`.
- `calendar.ts` — over a pack `MarketCalendar`: `isBusinessDay`,
  `businessDaysBetween` on `(from, to]`, `yearFraction` per `DayCount`,
  `longestClosureRun`, `stalenessWindowDays` (BR 2026 = 5).
- `types.ts` — kernel input rows (`LedgerTransaction`, `ExternalCashFlow`,
  `HoldingAsset`, `PriceObservation`, `SeriesObservation`) with decimal
  strings, and `buildMarketData` — a validated, date-indexed read-only
  lookup with binary-search "latest at or before".
- `index.ts` — public surface.

## Modules (Phase 2 — present)

- `staleness.ts` — `classify(observedOn, asOf, windowDays)` → fresh /
  carried_forward / stale, and the shared `Observed<T>` result shape with the
  closed `UnpricedReason` set. Pulled forward from Phase 3 because Phase 2's
  carry-forward property needs it.
- `positions.ts` — `sortLedger` (`(tradeDate, rank, id)`, rank
  `buy < dividend = interest = fee < sell`), `groupByAsset`, `lotsAt` (FIFO,
  `oversell` throws), `quantityAt`, `netInvested` over `(from, to]`.
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

## Planned (Phases 3–5)

`valuation/` (one module per closed `ValuationStrategy`), `portfolio.ts`,
`twr.ts`, `mwr.ts` (XIRR), `contribution.ts`, `attribution.ts`, `real.ts`,
`golden.ts`.

`pnpm test:calc` runs only this directory and carries the `fast-check`
properties the plan names for each phase.

All series rates arrive in unit form (`"0.12"` means 12%). Yield-curve input
is grouped by `(series_id, date)` and contains one positive `tenor_days` point
per manifest tenor. Do not add compatibility branches for percentage-point
input; normalization belongs at the pack boundary.
