/**
 * Real returns (docs/milestone-2-plan.md "Real returns"; root SPEC §6):
 *
 *   (1 + R_nominal) / (1 + π) − 1,   π = level(to) / level(from) − 1
 *
 * with the levels from a `deflator`-role `inflation_index` series through
 * `inflationLevelAt`. The status is the worse of the two legs; a stale leg
 * still yields a number, for display only.
 */
import type { IsoDate, SeriesDescriptor } from "@/packs/types";
import { ONE, type KDecimal } from "./decimal";
import { KernelError } from "./errors";
import { inflationLevelAt } from "./series";
import { hasValue, unpriced, worseOf, type Observed } from "./staleness";
import type { MarketData } from "./types";

export function realReturn(
  nominal: KDecimal,
  market: MarketData,
  deflator: SeriesDescriptor,
  from: IsoDate,
  to: IsoDate,
): Observed<KDecimal> {
  if (deflator.kind.kind !== "inflation_index") {
    throw new KernelError("unsupported_convention", "a deflator must be an inflation_index series", {
      seriesId: deflator.id,
      kind: deflator.kind.kind,
    });
  }
  const start = inflationLevelAt(market, deflator.id, from, deflator.kind.interpolation);
  const end = inflationLevelAt(market, deflator.id, to, deflator.kind.interpolation);
  if (start.status === "unpriced") return start;
  if (end.status === "unpriced") return end;
  const startLevel = hasValue(start) ? start.value : start.lastKnown;
  const endLevel = hasValue(end) ? end.value : end.lastKnown;
  if (startLevel.isZero()) return unpriced("no_observation");
  const inflation = endLevel.div(startLevel);
  const real = ONE.plus(nominal).div(inflation).minus(ONE);
  const status = worseOf(start.status, end.status);
  if (status === "stale") return { status, lastKnown: real, observedOn: end.observedOn };
  return { status, value: real, observedOn: end.observedOn };
}
