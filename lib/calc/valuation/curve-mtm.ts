/**
 * `curve_mark_to_market` — present value of the remaining cash flows off a
 * published curve (docs/milestone-2-plan.md "Valuation strategies"; PACKS §5).
 *
 * Per unit: face value 1; coupons every `12 / frequency` months counted BACK
 * from `maturity` (each computed from maturity, never chained, so
 * end-of-month clamping cannot drift), each `rate / frequency`; principal at
 * maturity. Flows dated ≥ asOf are included with `DF(0) = 1`, so on the
 * maturity day the bond is worth par plus its final coupon. Past maturity the
 * holding is `unpriced` with `matured`: a past flow has no present value.
 *
 * `indexation !== null` is `unpriced` with `indexation_not_supported` in this
 * milestone (decision 7): the inflation-linked path needs an index base date
 * the PACKS §5 shape does not carry, and waits for a real instrument.
 */
import type { z } from "zod";
import type { IsoDate } from "@/packs/types";
import { CurveMetadataBaseSchema } from "@/packs/schema";
import { ONE, ZERO, parseDecimal, type KDecimal } from "../decimal";
import { addMonths, compareDates, daysBetween } from "../dates";
import { KernelError } from "../errors";
import { Money } from "../money";
import { curveAt, discountFactor } from "../series";
import { hasValue, unpriced } from "../staleness";
import type { HoldingAsset } from "../types";
import type { HoldingValue, ValuationContext } from "./result";

export interface BondCashFlow {
  date: IsoDate;
  /** Per unit of face value. */
  amount: KDecimal;
}

type Coupon = z.infer<typeof CurveMetadataBaseSchema>["coupon"];

/** Remaining flows as of `asOf`, ascending by date. */
export function bondCashFlows(maturity: IsoDate, coupon: Coupon, asOf: IsoDate): readonly BondCashFlow[] {
  const flows: BondCashFlow[] = [];
  if (coupon) {
    const stepMonths = 12 / coupon.frequency;
    const perCoupon = parseDecimal(coupon.rate, "coupon.rate").div(coupon.frequency);
    for (let k = 0; ; k += 1) {
      const date = addMonths(maturity, -k * stepMonths);
      if (compareDates(date, asOf) < 0) break;
      flows.push({ date, amount: perCoupon });
    }
  }
  flows.push({ date: maturity, amount: ONE });
  return flows.sort((a, b) => compareDates(a.date, b.date));
}

export function valueCurveMtm(
  asset: HoldingAsset,
  quantity: KDecimal,
  asOf: IsoDate,
  ctx: ValuationContext,
): HoldingValue {
  const strategy = asset.instrumentKind.valuation;
  if (strategy.kind !== "curve_mark_to_market") {
    throw new KernelError("invalid_input", "valueCurveMtm needs a curve_mark_to_market strategy", {
      assetId: asset.id,
      kind: strategy.kind,
    });
  }
  const metadata = CurveMetadataBaseSchema.safeParse(asset.metadata);
  if (!metadata.success) return unpriced("invalid_metadata");
  const { maturity, coupon, indexation } = metadata.data;
  if (indexation !== null) return unpriced("indexation_not_supported");
  if (compareDates(maturity, asOf) < 0) return unpriced("matured");

  const curve = curveAt(ctx.market, strategy.seriesId, asOf, ctx.windowDays);
  if (curve.status === "unpriced") return curve;
  const points = hasValue(curve) ? curve.value : curve.lastKnown;

  let unitValue: KDecimal = ZERO;
  for (const flow of bondCashFlows(maturity, coupon, asOf)) {
    unitValue = unitValue.plus(flow.amount.times(discountFactor(points, daysBetween(asOf, flow.date))));
  }
  const native = Money.of(quantity.times(unitValue), asset.nativeCurrency);
  if (curve.status === "stale") return { status: "stale", lastKnown: native, unitValue, priceDate: curve.observedOn };
  return { status: curve.status, native, unitValue, priceDate: curve.observedOn };
}
