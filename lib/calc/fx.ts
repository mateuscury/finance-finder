/**
 * FX resolution (docs/milestone-2-plan.md "FX"; PACKS.md §8).
 *
 *   1. native === base → rate 1, not derived, no fx date.
 *   2. A direct `fx_rate` series `base = native, quote = base` multiplies;
 *      one with `base = base, quote = native` divides.
 *   3. Otherwise triangulate through USD with any two direct legs;
 *      `derived: true`.
 *   4. Each leg is carried forward within the asset's window; the result is
 *      carried forward if any leg is, and stale if any leg is.
 *   5. No usable series → `unpriced` with `no_fx_series`.
 *
 * `fxDate` is the date of the OLDEST leg observation used: the number is only
 * as fresh as its least fresh input.
 */
import type { IsoDate, SeriesDescriptor } from "@/packs/types";
import { ONE, type KDecimal } from "./decimal";
import { compareDates } from "./dates";
import { fxRateAt } from "./series/fx-rate";
import { hasValue, type Observed } from "./staleness";
import type { MarketData } from "./types";

export type FxResult =
  | { status: "ok" | "carried_forward"; rate: KDecimal; derived: boolean; fxDate: IsoDate | null }
  | { status: "stale"; lastKnown: KDecimal; derived: boolean; fxDate: IsoDate }
  | { status: "unpriced"; reason: "no_fx_series" };

const PIVOT = "USD";

/** One leg: the series that converts `from` → `to`, direct or inverted. */
function findLeg(
  descriptors: readonly SeriesDescriptor[],
  from: string,
  to: string,
): { seriesId: string; invert: boolean } | null {
  for (const d of descriptors) {
    if (d.kind.kind !== "fx_rate") continue;
    if (d.kind.base === from && d.kind.quote === to) return { seriesId: d.id, invert: false };
  }
  for (const d of descriptors) {
    if (d.kind.kind !== "fx_rate") continue;
    if (d.kind.base === to && d.kind.quote === from) return { seriesId: d.id, invert: true };
  }
  return null;
}

function legRate(
  market: MarketData,
  leg: { seriesId: string; invert: boolean },
  asOf: IsoDate,
  windowDays: number,
): Observed<KDecimal> {
  const o = fxRateAt(market, leg.seriesId, asOf, windowDays);
  if (!leg.invert) return o;
  if (o.status === "unpriced") return o;
  if (o.status === "stale") return { ...o, lastKnown: ONE.div(o.lastKnown) };
  return { ...o, value: ONE.div(o.value) };
}

function combine(legs: readonly Observed<KDecimal>[], derived: boolean): FxResult {
  let rate: KDecimal = ONE;
  let fxDate: IsoDate | null = null;
  let carried = false;
  let stale = false;
  for (const leg of legs) {
    if (leg.status === "unpriced") return { status: "unpriced", reason: "no_fx_series" };
    rate = rate.times(hasValue(leg) ? leg.value : leg.lastKnown);
    if (leg.status === "carried_forward") carried = true;
    if (leg.status === "stale") stale = true;
    if (fxDate === null || compareDates(leg.observedOn, fxDate) < 0) fxDate = leg.observedOn;
  }
  if (stale && fxDate !== null) return { status: "stale", lastKnown: rate, derived, fxDate };
  return { status: carried ? "carried_forward" : "ok", rate, derived, fxDate };
}

export function resolveFx(
  market: MarketData,
  descriptors: readonly SeriesDescriptor[],
  native: string,
  base: string,
  asOf: IsoDate,
  windowDays: number,
): FxResult {
  if (native === base) return { status: "ok", rate: ONE, derived: false, fxDate: null };

  const direct = findLeg(descriptors, native, base);
  if (direct) return combine([legRate(market, direct, asOf, windowDays)], false);

  if (native === PIVOT || base === PIVOT) return { status: "unpriced", reason: "no_fx_series" };
  const first = findLeg(descriptors, native, PIVOT);
  const second = findLeg(descriptors, PIVOT, base);
  if (!first || !second) return { status: "unpriced", reason: "no_fx_series" };
  return combine([legRate(market, first, asOf, windowDays), legRate(market, second, asOf, windowDays)], true);
}
