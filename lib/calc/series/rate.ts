/**
 * `rate_daily` and `rate_annual` — compounding over `(from, to]`
 * (docs/milestone-2-plan.md "Series kinds").
 *
 * Every covered day must have a point. A missing day is a GAP and the result
 * is `unpriced` with `series_gap`: a rate is never carried forward, because
 * that would fabricate an accrual for a day the source never published.
 *
 * `multiplier` is the "110% do CDI" factor applied to each day's rate before
 * compounding — the CETIP/B3 convention. It defaults to 1.
 */
import type { IsoDate, MarketCalendar, SeriesKind } from "@/packs/types";
import { isBusinessDay } from "../calendar";
import { ONE, parseDecimal, type KDecimal } from "../decimal";
import { addDays, compareDates } from "../dates";
import { KernelError } from "../errors";
import type { MarketData } from "../types";

export type RateKind = Extract<SeriesKind, { kind: "rate_daily" | "rate_annual" }>;

export type CompoundResult =
  | { status: "ok"; factor: KDecimal; days: number }
  | { status: "unpriced"; reason: "series_gap"; missingDate: IsoDate };

/** Days in (from, to] the rate applies to: business days for BUS/252, calendar days for ACT/*. */
function coveredDays(kind: RateKind, calendar: MarketCalendar, from: IsoDate, to: IsoDate): IsoDate[] {
  const days: IsoDate[] = [];
  const business = kind.dayCount === "BUS/252";
  for (let d = addDays(from, 1); compareDates(d, to) <= 0; d = addDays(d, 1)) {
    if (!business || isBusinessDay(calendar, d)) days.push(d);
  }
  return days;
}

export function compoundRate(
  market: MarketData,
  seriesId: string,
  kind: RateKind,
  calendar: MarketCalendar,
  from: IsoDate,
  to: IsoDate,
  multiplier: KDecimal = ONE,
): CompoundResult {
  if (compareDates(from, to) > 0) {
    throw new KernelError("invalid_input", "compoundRate needs from ≤ to", { seriesId, from, to });
  }
  if (kind.dayCount === "30/360") {
    throw new KernelError("unsupported_convention", "30/360 has no daily observation to compound", {
      seriesId,
      kind: kind.kind,
    });
  }
  let perYear: number | null = null;
  if (kind.kind === "rate_annual") {
    if (kind.dayCount === "BUS/252") perYear = 252;
    else if (kind.dayCount === "ACT/365") perYear = 365;
    else {
      throw new KernelError("unsupported_convention", "rate_annual is defined for BUS/252 and ACT/365 only", {
        seriesId,
        dayCount: kind.dayCount,
      });
    }
  }
  const exponent = perYear === null ? null : ONE.div(perYear);

  let factor: KDecimal = ONE;
  const days = coveredDays(kind, calendar, from, to);
  for (const day of days) {
    const point = market.pointsOn(seriesId, day).find((p) => p.tenorDays === 0);
    if (!point) return { status: "unpriced", reason: "series_gap", missingDate: day };
    const daily = ONE.plus(multiplier.times(parseDecimal(point.value, `${seriesId} rate`)));
    factor = factor.times(exponent === null ? daily : daily.pow(exponent));
  }
  return { status: "ok", factor, days: days.length };
}
