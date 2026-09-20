/**
 * One module per closed `ValuationStrategy` (docs/milestone-2-plan.md
 * "Valuation strategies"), and the one dispatcher the portfolio builder
 * calls. Every result is a `HoldingValue`: `ok` / `carried_forward` with the
 * native value, `stale` with the last known value, or `unpriced` with a fixed
 * reason — never NaN, never a number built on missing data.
 */
import type { IsoDate } from "@/packs/types";
import { KernelError } from "../errors";
import { lotQuantity, type Lot } from "../positions";
import type { HoldingAsset } from "../types";
import { valueAccrual } from "./accrual";
import { valueCurveMtm } from "./curve-mtm";
import { valueMarketPrice } from "./market-price";
import { valueNavUnitPrice } from "./nav-unit-price";
import type { HoldingValue, ValuationContext } from "./result";

export { AccrualMetadataSchema, valueAccrual } from "./accrual";
export { valueCurveMtm } from "./curve-mtm";
export { valueMarketPrice } from "./market-price";
export { NAV_EXTRA_DAYS, valueNavUnitPrice } from "./nav-unit-price";
export { findSeries, type HoldingValue, type ValuationContext } from "./result";

/** Values ONE asset's open lots as of `asOf`. Callers never pass empty lots. */
export function valueHolding(asset: HoldingAsset, lots: readonly Lot[], asOf: IsoDate, ctx: ValuationContext): HoldingValue {
  if (lots.length === 0) throw new KernelError("invalid_input", "valueHolding needs at least one open lot", { assetId: asset.id });
  const strategy = asset.instrumentKind.valuation;
  switch (strategy.kind) {
    case "market_price":
      return valueMarketPrice(asset, lotQuantity(lots), asOf, ctx);
    case "nav_unit_price":
      return valueNavUnitPrice(asset, lotQuantity(lots), asOf, ctx);
    case "accrual":
      return valueAccrual(asset, lots, asOf, ctx);
    case "curve_mark_to_market":
      return valueCurveMtm(asset, lotQuantity(lots), asOf, ctx);
  }
}
