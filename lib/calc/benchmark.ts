/**
 * The return of a series over a window (MILESTONES.md §4 decision 37): one
 * function over the closed `SeriesKind` union, so a pack's `benchmark`
 * role needs no per-kind UI code. Every branch delegates to the series
 * module that owns the kind; the result is the shared `Observed` shape —
 * `ok` or `carried_forward` with the rate, `stale` with the last known
 * rate (shown, never charted as confident), `unpriced` with a reason.
 *
 * - `index_level` → `indexReturn`: `level(to) / level(from) − 1`.
 * - `rate_daily` / `rate_annual` → `compoundRate` over `(from, to]` on the
 *   pack calendar: `Π(1 + r_d) − 1`; a missing day is `series_gap`.
 * - `inflation_index` → the interpolated level ratio − 1.
 * - `fx_rate` → the rate ratio − 1.
 * - `yield_curve` → `unpriced` with `not_a_return_series`: a curve is a set
 *   of tenors, not a single return.
 */
import type { IsoDate, MarketCalendar, SeriesDescriptor } from "@/packs/types";
import type { KDecimal } from "./decimal";
import { compareDates } from "./dates";
import { KernelError } from "./errors";
import { compoundRate, fxRateAt, indexReturn, inflationLevelAt } from "./series";
import { hasValue, unpriced, worseOf, type Observed } from "./staleness";
import type { MarketData } from "./types";

export interface SeriesReturnContext {
  /** The calendar of the pack that owns the series — business days for a BUS/252 rate. */
  calendar: MarketCalendar;
  /** Staleness window for the window's end date, from that calendar. */
  windowDays: number;
}

/** The ratio of two observed levels, minus one, with the worse status. */
function ratioReturn(start: Observed<KDecimal>, end: Observed<KDecimal>): Observed<KDecimal> {
  if (start.status === "unpriced") return start;
  if (end.status === "unpriced") return end;
  const s = hasValue(start) ? start.value : start.lastKnown;
  const e = hasValue(end) ? end.value : end.lastKnown;
  if (s.isZero()) return unpriced("no_observation");
  const value = e.div(s).minus(1);
  const status = worseOf(start.status, end.status);
  return status === "stale"
    ? { status, lastKnown: value, observedOn: end.observedOn }
    : { status, value, observedOn: end.observedOn };
}

export function seriesReturn(
  descriptor: SeriesDescriptor,
  market: MarketData,
  from: IsoDate,
  to: IsoDate,
  ctx: SeriesReturnContext,
): Observed<KDecimal> {
  if (compareDates(from, to) > 0) {
    throw new KernelError("invalid_input", "seriesReturn needs from ≤ to", { seriesId: descriptor.id, from, to });
  }
  const kind = descriptor.kind;
  switch (kind.kind) {
    case "index_level":
      return indexReturn(market, descriptor.id, from, to, ctx.windowDays);
    case "rate_daily":
    case "rate_annual": {
      const r = compoundRate(market, descriptor.id, kind, ctx.calendar, from, to);
      if (r.status === "unpriced") return unpriced(r.reason);
      return { status: "ok", value: r.factor.minus(1), observedOn: to };
    }
    case "inflation_index":
      return ratioReturn(
        inflationLevelAt(market, descriptor.id, from, kind.interpolation),
        inflationLevelAt(market, descriptor.id, to, kind.interpolation),
      );
    case "fx_rate":
      return ratioReturn(
        fxRateAt(market, descriptor.id, from, ctx.windowDays),
        fxRateAt(market, descriptor.id, to, ctx.windowDays),
      );
    case "yield_curve":
      return unpriced("not_a_return_series");
  }
}
