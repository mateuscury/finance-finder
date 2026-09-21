# lib/format — figures from decimal strings

Every number a person reads is formatted here, from the decimal string the
kernel or the database produced, and never through a JS float: a 30-digit
total prints exactly (docs/milestone-4-plan.md "Formatting never goes
through a float"). `Intl.NumberFormat` is used only as a _template_ — where
the locale places the sign, the symbol and the separators — and the digits
are rounded by the kernel's `Decimal` (ROUND_HALF_EVEN).

- `formatMoney(amount, currency, locale)` — two decimals, symbol per locale.
- `formatChange(delta, currency, locale)` — signed text plus the direction
  (`pos | neg | zero`) so a screen pairs colour with a sign and an arrow.
- `formatPercent(unitRate, locale)` — `"0.1234"` → `+12,34 %`, with direction.
- `formatShare(unitShare, locale)` — an unsigned percentage of a whole.
- `formatQuantity` / `formatPrice` — up to ten decimals, trailing zeros trimmed.
- `formatDate(iso, locale, style)` / `formatMonth` — a calendar day in UTC.

`lib/format/*.test.ts` checks the output against Intl's own for values a
float can represent, and the digits verbatim for values it cannot.
