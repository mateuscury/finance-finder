/**
 * Shapes shared by the valuation modules (docs/milestone-2-plan.md
 * "Valuation strategies").
 */
import type { IsoDate, MarketCalendar, SeriesDescriptor } from "@/packs/types";
import type { KDecimal } from "../decimal";
import type { Money } from "../money";
import type { UnpricedReason } from "../staleness";
import type { MarketData } from "../types";

export interface ValuationContext {
  market: MarketData;
  /** The ASSET's pack calendar — drives day counts and the staleness window. */
  calendar: MarketCalendar;
  /** Staleness window for the year of the valuation date, from that calendar. */
  windowDays: number;
  /** Every series descriptor in scope, to resolve an accrual index or a curve by id. */
  series: readonly SeriesDescriptor[];
}

export type HoldingValue =
  | { status: "ok" | "carried_forward"; native: Money; unitValue: KDecimal; priceDate: IsoDate }
  | { status: "stale"; lastKnown: Money; unitValue: KDecimal; priceDate: IsoDate }
  | { status: "unpriced"; reason: UnpricedReason };

export function findSeries(series: readonly SeriesDescriptor[], seriesId: string): SeriesDescriptor | undefined {
  return series.find((d) => d.id === seriesId);
}
