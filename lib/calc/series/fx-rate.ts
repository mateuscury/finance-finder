/**
 * `fx_rate` — quote-currency units per one base-currency unit, carried
 * forward within the asset's window, stale beyond
 * (docs/milestone-2-plan.md "Series kinds"). Pairing, inversion and USD
 * triangulation live in `../fx.ts`; this module answers "what did this one
 * series say as of the date".
 */
import type { IsoDate } from "@/packs/types";
import type { KDecimal } from "../decimal";
import type { Observed } from "../staleness";
import type { MarketData } from "../types";
import { observeScalar } from "./observe";

export function fxRateAt(market: MarketData, seriesId: string, asOf: IsoDate, windowDays: number): Observed<KDecimal> {
  return observeScalar(market, seriesId, asOf, windowDays);
}
