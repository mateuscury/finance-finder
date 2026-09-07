# lib/calc — kernel math

Pure functions only. Owned by the kernel; packs never import from here
(enforced by lint and the conformance dependency check, PACKS.md §11.7).

Planned modules (Milestones 1–3, per SPEC.md formulas):

- `money.ts` — `Money` on decimal.js, ARCHITECTURE §4.4 discipline.
- `twr.ts`, `mwr.ts` (XIRR), `contribution.ts`, `fx-attribution.ts`.
- `valuation/` — one module per closed `ValuationStrategy` kind.
- `series/` — one cumulative-return function per closed `SeriesKind`.
- `fx.ts` — resolution, USD triangulation, carry-forward with staleness flags (PACKS.md §8).

Nothing here yet. Formulas: SPEC.md §4–§6. `pnpm test:calc` runs only this
directory.

All series rates arrive in unit form (`"0.12"` means 12%). Yield-curve input is
grouped by `(series_id, date)` and contains one positive `tenor_days` point per
manifest tenor. Do not add compatibility branches for percentage-point input;
normalization belongs at the pack boundary.
