/**
 * `nav_unit_price` — identical lookup to `market_price` with a window two
 * calendar days wider, because a NAV published D+1 is normal (PACKS §5;
 * docs/milestone-2-plan.md "Calendar and staleness").
 */
import type { IsoDate } from "@/packs/types";
import type { KDecimal } from "../decimal";
import type { HoldingAsset } from "../types";
import { valueAtLatestPrice } from "./market-price";
import type { HoldingValue, ValuationContext } from "./result";

export const NAV_EXTRA_DAYS = 2;

export function valueNavUnitPrice(
  asset: HoldingAsset,
  quantity: KDecimal,
  asOf: IsoDate,
  ctx: ValuationContext,
): HoldingValue {
  return valueAtLatestPrice(asset, quantity, asOf, ctx, ctx.windowDays + NAV_EXTRA_DAYS);
}
