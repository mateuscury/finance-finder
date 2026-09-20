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

## Planned (Phases 2–5)

`positions.ts` (FIFO lots), `series/` (one function per closed
`SeriesKind`), `fx.ts` (direct, inverted, USD triangulation, carry-forward),
`staleness.ts`, `valuation/` (one module per closed `ValuationStrategy`),
`portfolio.ts`, `twr.ts`, `mwr.ts` (XIRR), `contribution.ts`,
`attribution.ts`, `real.ts`, `golden.ts`.

`pnpm test:calc` runs only this directory and carries the `fast-check`
properties the plan names for each phase.

All series rates arrive in unit form (`"0.12"` means 12%). Yield-curve input
is grouped by `(series_id, date)` and contains one positive `tenor_days` point
per manifest tenor. Do not add compatibility branches for percentage-point
input; normalization belongs at the pack boundary.
