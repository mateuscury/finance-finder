/**
 * Shared "latest scalar observation at or before a date, with staleness"
 * lookup used by the price-like series kinds (index levels, FX rates).
 */
import type { IsoDate } from "@/packs/types";
import { parseDecimal, type KDecimal } from "../decimal";
import { observed, unpriced, type Observed } from "../staleness";
import type { MarketData } from "../types";

export function observeScalar(
  market: MarketData,
  seriesId: string,
  asOf: IsoDate,
  windowDays: number,
): Observed<KDecimal> {
  const point = market.latestScalarAtOrBefore(seriesId, asOf);
  if (!point) return unpriced("no_observation");
  return observed(parseDecimal(point.value, `${seriesId} value`), point.date, asOf, windowDays);
}
