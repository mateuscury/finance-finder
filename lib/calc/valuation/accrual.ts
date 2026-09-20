/**
 * `accrual` — value compounds from a contracted rate, never from a quote
 * (docs/milestone-2-plan.md "Valuation strategies"; MILESTONES.md §2
 * decisions 9, 13, 14).
 *
 *   value = Σ_lots quantity × unitPrice × factor(lot.openedOn, asOf)
 *
 * The factor covers `(openedOn, asOf]`, so a deposit made today is worth
 * exactly its principal today. Metadata `rate` is an EFFECTIVE ANNUAL rate in
 * unit form ("0.12"), except in `percent_of_index` mode where it is the
 * multiplier ("1.10" = 110% do CDI).
 *
 * `compounding` is the recognition granularity of that rate (decision 9):
 * `daily` accrues smoothly every day, `monthly` recognises
 * `(1 + rate)^(completedMonths / 12)` and steps on each monthly anniversary of
 * the lot, `annual` steps on each yearly anniversary. Terminal values agree at
 * whole periods; only the path differs.
 *
 * Support matrix (decision 13) — every other cell throws
 * `unsupported_convention`, never guesses:
 *
 *   mode               daily                          monthly / annual
 *   plain              (1+r)^yearFraction(dayCount)   (1+r)^(months/12), dayCount unused
 *   percent_of_index   Π(1 + r·i_d) via compoundRate  —
 *                      (rate_daily | rate_annual index,
 *                       convention.dayCount = index dayCount)
 *   index_plus_spread  level(asOf)/level(openedOn)    level ratio × (1+r)^(months/12)
 *                      × (1+r)^yearFraction           (inflation_index | index_level)
 *
 * `maturity` is never read (decision 14): a lot accrues until a sell closes
 * it, and a matured holding with no recorded redemption is missing data for
 * the Maturities screen to surface, not a number to freeze.
 */
import { z } from "zod";
import type { AccrualConvention, IsoDate, SeriesDescriptor } from "@/packs/types";
import { DecimalStringSchema } from "@/packs/schema";
import { yearFraction } from "../calendar";
import { KernelDecimal, ONE, ZERO, type KDecimal } from "../decimal";
import { completedMonths } from "../dates";
import { KernelError } from "../errors";
import { Money } from "../money";
import type { Lot } from "../positions";
import { compoundRate, inflationLevelAt, levelAt } from "../series";
import { hasValue, unpriced, worseOf, type Observed, type UnpricedReason, type ValueStatus } from "../staleness";
import type { HoldingAsset } from "../types";
import { findSeries, type HoldingValue, type ValuationContext } from "./result";

/** What the kernel needs from `assets.metadata`; the pack schema may say more. */
export const AccrualMetadataSchema = z.object({ rate: DecimalStringSchema });

type LotFactor =
  | { status: ValueStatus; factor: KDecimal; observedOn: IsoDate }
  | { status: "unpriced"; reason: UnpricedReason };

function unsupported(message: string, details: Record<string, string | number | null>): KernelError {
  return new KernelError("unsupported_convention", message, details);
}

/** `(1 + rate)` raised to the elapsed time the granularity recognises. */
function rateFactor(rate: KDecimal, convention: AccrualConvention, ctx: ValuationContext, from: IsoDate, to: IsoDate): KDecimal {
  const growth = ONE.plus(rate);
  switch (convention.compounding) {
    case "daily":
      return growth.pow(yearFraction(ctx.calendar, convention.dayCount, from, to));
    case "monthly":
      return growth.pow(new KernelDecimal(completedMonths(from, to)).div(12));
    case "annual": {
      const months = completedMonths(from, to);
      return growth.pow((months - (months % 12)) / 12);
    }
  }
}

function descriptorFor(ctx: ValuationContext, seriesId: string, assetId: string): SeriesDescriptor {
  const d = findSeries(ctx.series, seriesId);
  if (!d) throw new KernelError("invalid_input", "accrual index series is not in scope", { assetId, seriesId });
  return d;
}

function levelFor(ctx: ValuationContext, descriptor: SeriesDescriptor, date: IsoDate, assetId: string): Observed<KDecimal> {
  const kind = descriptor.kind;
  if (kind.kind === "inflation_index") return inflationLevelAt(ctx.market, descriptor.id, date, kind.interpolation);
  if (kind.kind === "index_level") return levelAt(ctx.market, descriptor.id, date, ctx.windowDays);
  throw unsupported("index_plus_spread needs an inflation_index or index_level series", {
    assetId,
    seriesId: descriptor.id,
    kind: kind.kind,
  });
}

function lotFactor(
  asset: HoldingAsset,
  rate: KDecimal,
  convention: AccrualConvention,
  lot: Lot,
  asOf: IsoDate,
  ctx: ValuationContext,
): LotFactor {
  const index = convention.index;
  if (!index) return { status: "ok", factor: rateFactor(rate, convention, ctx, lot.openedOn, asOf), observedOn: asOf };

  if (index.mode === "percent_of_index") {
    const descriptor = descriptorFor(ctx, index.seriesId, asset.id);
    const kind = descriptor.kind;
    if (convention.compounding !== "daily") {
      throw unsupported("percent_of_index is defined for daily compounding only", {
        assetId: asset.id,
        compounding: convention.compounding,
      });
    }
    if (kind.kind !== "rate_daily" && kind.kind !== "rate_annual") {
      throw unsupported("percent_of_index needs a rate_daily or rate_annual series", {
        assetId: asset.id,
        seriesId: descriptor.id,
        kind: kind.kind,
      });
    }
    if (kind.dayCount !== convention.dayCount) {
      throw unsupported("percent_of_index day count must match the index series", {
        assetId: asset.id,
        seriesId: descriptor.id,
        convention: convention.dayCount,
        series: kind.dayCount,
      });
    }
    const r = compoundRate(ctx.market, descriptor.id, kind, ctx.calendar, lot.openedOn, asOf, rate);
    if (r.status === "unpriced") return { status: "unpriced", reason: r.reason };
    return { status: "ok", factor: r.factor, observedOn: asOf };
  }

  // index_plus_spread: level ratio × the spread's own factor.
  const descriptor = descriptorFor(ctx, index.seriesId, asset.id);
  const start = levelFor(ctx, descriptor, lot.openedOn, asset.id);
  const end = levelFor(ctx, descriptor, asOf, asset.id);
  if (start.status === "unpriced") return start;
  if (end.status === "unpriced") return end;
  const startLevel = hasValue(start) ? start.value : start.lastKnown;
  const endLevel = hasValue(end) ? end.value : end.lastKnown;
  if (startLevel.isZero()) return unpriced("no_observation");
  const factor = endLevel.div(startLevel).times(rateFactor(rate, convention, ctx, lot.openedOn, asOf));
  return { status: worseOf(start.status, end.status), factor, observedOn: end.observedOn };
}

export function valueAccrual(asset: HoldingAsset, lots: readonly Lot[], asOf: IsoDate, ctx: ValuationContext): HoldingValue {
  const strategy = asset.instrumentKind.valuation;
  if (strategy.kind !== "accrual") {
    throw new KernelError("invalid_input", "valueAccrual needs an accrual strategy", { assetId: asset.id, kind: strategy.kind });
  }
  const metadata = AccrualMetadataSchema.safeParse(asset.metadata);
  if (!metadata.success) return unpriced("invalid_metadata");
  const rate = new KernelDecimal(metadata.data.rate);

  let native: KDecimal = ZERO;
  let quantity: KDecimal = ZERO;
  let status: ValueStatus = "ok";
  let priceDate: IsoDate = asOf;
  for (const lot of lots) {
    if (lot.currency !== asset.nativeCurrency) {
      throw new KernelError("currency_mismatch", "lot currency differs from the asset's native currency", {
        assetId: asset.id,
        transactionId: lot.transactionId,
        lot: lot.currency,
        native: asset.nativeCurrency,
      });
    }
    const f = lotFactor(asset, rate, strategy.convention, lot, asOf, ctx);
    if (f.status === "unpriced") return f;
    native = native.plus(lot.quantity.times(lot.unitPrice).times(f.factor));
    quantity = quantity.plus(lot.quantity);
    status = worseOf(status, f.status);
    priceDate = f.observedOn;
  }
  const money = Money.of(native, asset.nativeCurrency);
  const unitValue = native.div(quantity);
  if (status === "stale") return { status, lastKnown: money, unitValue, priceDate };
  return { status, native: money, unitValue, priceDate };
}
