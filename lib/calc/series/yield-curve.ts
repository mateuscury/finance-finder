/**
 * `yield_curve` — the curve observed at a date, and discounting off it
 * (docs/milestone-2-plan.md "Series kinds").
 *
 * Rates are linearly interpolated across the declared tenors and held flat
 * beyond either end. The curve kind carries no day count, so the discount
 * factor is `DF = (1 + r)^(−tenorDays/365)` — ACT/365 annual compounding is
 * the kernel default until a pack needs otherwise, which is a `SeriesKind`
 * change and an API bump.
 */
import type { IsoDate } from "@/packs/types";
import { KernelDecimal, ONE, parseDecimal, type KDecimal } from "../decimal";
import { KernelError } from "../errors";
import { observed, unpriced, type Observed } from "../staleness";
import type { MarketData } from "../types";

export interface CurvePoint {
  tenorDays: number;
  rate: KDecimal;
}

/** Ascending by tenor; at least one point. */
export type Curve = readonly CurvePoint[];

/** The curve on the latest date ≤ `asOf`, carried forward within the window. */
export function curveAt(market: MarketData, seriesId: string, asOf: IsoDate, windowDays: number): Observed<Curve> {
  const date = market.latestDateAtOrBefore(seriesId, asOf);
  if (date === null) return unpriced("no_observation");
  const points = market
    .pointsOn(seriesId, date)
    .filter((p) => p.tenorDays > 0)
    .map((p): CurvePoint => ({ tenorDays: p.tenorDays, rate: parseDecimal(p.value, `${seriesId} rate`) }));
  if (points.length === 0) return unpriced("no_observation");
  return observed(Object.freeze(points), date, asOf, windowDays);
}

/** Linear interpolation between the bracketing tenors; flat beyond the ends. */
export function rateAtTenor(curve: Curve, tenorDays: number): KDecimal {
  if (curve.length === 0) throw new KernelError("invalid_input", "empty curve");
  if (tenorDays <= curve[0].tenorDays) return curve[0].rate;
  const last = curve[curve.length - 1];
  if (tenorDays >= last.tenorDays) return last.rate;
  for (let i = 1; i < curve.length; i += 1) {
    const hi = curve[i];
    if (tenorDays <= hi.tenorDays) {
      const lo = curve[i - 1];
      if (hi.tenorDays === tenorDays) return hi.rate;
      const weight = new KernelDecimal(tenorDays - lo.tenorDays).div(hi.tenorDays - lo.tenorDays);
      return lo.rate.plus(hi.rate.minus(lo.rate).times(weight));
    }
  }
  return last.rate;
}

export function discountFactor(curve: Curve, tenorDays: number): KDecimal {
  if (tenorDays < 0) throw new KernelError("invalid_input", "tenorDays must not be negative", { tenorDays });
  if (tenorDays === 0) return ONE;
  const rate = rateAtTenor(curve, tenorDays);
  return ONE.plus(rate).pow(new KernelDecimal(-tenorDays).div(365));
}
