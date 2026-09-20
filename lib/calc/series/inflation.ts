/**
 * `inflation_index` — `levelAt(date)` (docs/milestone-2-plan.md "Series kinds").
 *
 * `none`: the last anchor ≤ date (a step function — that IS the value, so the
 * status is `ok` between anchors). `linear_daily`: linear interpolation on
 * calendar days between the two anchors bracketing the date. Before the
 * first anchor: `unpriced` with `before_first_anchor`. After the last
 * anchor: held flat and `carried_forward` for up to 62 calendar days (two
 * monthly prints), `stale` beyond.
 */
import type { IsoDate, SeriesKind } from "@/packs/types";
import { KernelDecimal, parseDecimal, type KDecimal } from "../decimal";
import { compareDates, daysBetween } from "../dates";
import { unpriced, type Observed } from "../staleness";
import type { MarketData, SeriesObservation } from "../types";

/** Two monthly prints: a print for month M lands during M+1, so M+2 is late. */
export const INFLATION_CARRY_DAYS = 62;

export type Interpolation = Extract<SeriesKind, { kind: "inflation_index" }>["interpolation"];

function anchorValue(point: SeriesObservation, seriesId: string): KDecimal {
  return parseDecimal(point.value, `${seriesId} level`);
}

export function inflationLevelAt(
  market: MarketData,
  seriesId: string,
  asOf: IsoDate,
  interpolation: Interpolation,
): Observed<KDecimal> {
  const anchors = market.seriesFor(seriesId).filter((p) => p.tenorDays === 0);
  if (anchors.length === 0) return unpriced("no_observation");
  if (compareDates(asOf, anchors[0].date) < 0) return unpriced("before_first_anchor");

  const prev = market.latestScalarAtOrBefore(seriesId, asOf);
  if (!prev) return unpriced("before_first_anchor");
  const prevValue = anchorValue(prev, seriesId);
  if (prev.date === asOf) return { status: "ok", value: prevValue, observedOn: asOf };

  // First anchor strictly after asOf, if any. Anchors are ascending.
  const next = anchors.find((p) => compareDates(p.date, asOf) > 0);
  if (!next) {
    const age = daysBetween(prev.date, asOf);
    return age <= INFLATION_CARRY_DAYS
      ? { status: "carried_forward", value: prevValue, observedOn: prev.date }
      : { status: "stale", lastKnown: prevValue, observedOn: prev.date };
  }

  if (interpolation === "none") return { status: "ok", value: prevValue, observedOn: prev.date };

  const nextValue = anchorValue(next, seriesId);
  const span = new KernelDecimal(daysBetween(prev.date, next.date));
  const elapsed = new KernelDecimal(daysBetween(prev.date, asOf));
  const value = prevValue.plus(nextValue.minus(prevValue).times(elapsed).div(span));
  return { status: "ok", value, observedOn: asOf };
}
