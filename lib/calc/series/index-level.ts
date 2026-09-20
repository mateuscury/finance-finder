/**
 * `index_level` — a level is a price: carried forward within the window,
 * stale beyond. Return over `[from, to]` is `level(to) / level(from) − 1`
 * (docs/milestone-2-plan.md "Series kinds").
 */
import type { IsoDate } from "@/packs/types";
import type { KDecimal } from "../decimal";
import { hasValue, unpriced, type Observed } from "../staleness";
import type { MarketData } from "../types";
import { observeScalar } from "./observe";

export function levelAt(market: MarketData, seriesId: string, asOf: IsoDate, windowDays: number): Observed<KDecimal> {
  return observeScalar(market, seriesId, asOf, windowDays);
}

/**
 * Status is the worse of the two legs (stale > carried_forward > ok);
 * `observedOn` is the `to` leg's observation date. A stale result still
 * carries the return computed from the last known levels, for display only.
 */
export function indexReturn(
  market: MarketData,
  seriesId: string,
  from: IsoDate,
  to: IsoDate,
  windowDays: number,
): Observed<KDecimal> {
  const start = levelAt(market, seriesId, from, windowDays);
  const end = levelAt(market, seriesId, to, windowDays);
  if (start.status === "unpriced") return start;
  if (end.status === "unpriced") return end;
  const startLevel = hasValue(start) ? start.value : start.lastKnown;
  const endLevel = hasValue(end) ? end.value : end.lastKnown;
  if (startLevel.isZero()) return unpriced("no_observation");
  const value = endLevel.div(startLevel).minus(1);
  if (start.status === "stale" || end.status === "stale") {
    return { status: "stale", lastKnown: value, observedOn: end.observedOn };
  }
  if (start.status === "carried_forward" || end.status === "carried_forward") {
    return { status: "carried_forward", value, observedOn: end.observedOn };
  }
  return { status: "ok", value, observedOn: end.observedOn };
}
