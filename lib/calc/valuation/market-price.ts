/**
 * `market_price` — `quantity × price`, price = latest observation ≤ date
 * within the window (docs/milestone-2-plan.md "Valuation strategies").
 */
import type { IsoDate } from "@/packs/types";
import { parseDecimal, type KDecimal } from "../decimal";
import { KernelError } from "../errors";
import { Money } from "../money";
import { observed, unpriced } from "../staleness";
import type { HoldingAsset } from "../types";
import type { HoldingValue, ValuationContext } from "./result";

export function valueAtLatestPrice(
  asset: HoldingAsset,
  quantity: KDecimal,
  asOf: IsoDate,
  ctx: ValuationContext,
  windowDays: number,
): HoldingValue {
  const price = ctx.market.latestPriceAtOrBefore(asset.id, asOf);
  if (!price) return unpriced("no_price");
  if (price.currency !== asset.nativeCurrency) {
    throw new KernelError("currency_mismatch", "price currency differs from the asset's native currency", {
      assetId: asset.id,
      date: price.date,
      price: price.currency,
      native: asset.nativeCurrency,
    });
  }
  const unitValue = parseDecimal(price.price, "price");
  const o = observed(unitValue, price.date, asOf, windowDays);
  if (o.status === "unpriced") return o;
  const native = Money.of(quantity.times(unitValue), asset.nativeCurrency);
  if (o.status === "stale") return { status: "stale", lastKnown: native, unitValue, priceDate: o.observedOn };
  return { status: o.status, native, unitValue, priceDate: o.observedOn };
}

export function valueMarketPrice(asset: HoldingAsset, quantity: KDecimal, asOf: IsoDate, ctx: ValuationContext): HoldingValue {
  return valueAtLatestPrice(asset, quantity, asOf, ctx, ctx.windowDays);
}
