/**
 * Asset-versus-FX attribution for one holding over `[from, to]`
 * (docs/milestone-2-plan.md "Attribution"; root SPEC §6).
 *
 * The window is split at the asset's own transaction dates so the lot set is
 * constant inside each sub-period; each sub-period is valued at both ends
 * with the lots open at its START, so a transaction on the boundary cannot
 * leak into the return. Per sub-period
 *
 *   R_native = V_native(end) / V_native(start) − 1
 *   R_base   = V_base(end)   / V_base(start)   − 1
 *
 * both chained geometrically; then FX is the RESIDUAL,
 *
 *   R_fx = (1 + R_base) / (1 + R_native) − 1,
 *
 * so `(1 + R_base) = (1 + R_native)(1 + R_fx)` holds exactly by construction
 * and equals the pure FX return whenever quantity is constant. A holding in
 * the base currency has `R_fx = 0` exactly.
 *
 * A boundary that is `stale` or `unpriced` makes the result null with the
 * reason; a window in which the asset was never held is `no_position`.
 */
import type { IsoDate } from "@/packs/types";
import { ONE, type KDecimal } from "./decimal";
import { compareDates } from "./dates";
import { KernelError } from "./errors";
import { resolveFx } from "./fx";
import { groupByAsset, lotsAt } from "./positions";
import { stalenessWindowFor, type PortfolioInput } from "./portfolio";
import type { UnpricedReason } from "./staleness";
import { valueHolding, type ValuationContext } from "./valuation";

export type AttributionReason = UnpricedReason | "stale" | "no_position";

export interface Attribution {
  assetId: string;
  from: IsoDate;
  to: IsoDate;
  /** Sub-period boundaries actually chained (the first may be later than `from`). */
  boundaries: readonly IsoDate[];
  rNative: KDecimal | null;
  rBase: KDecimal | null;
  rFx: KDecimal | null;
  reason?: AttributionReason;
}

type Legs = { native: KDecimal; base: KDecimal } | { reason: AttributionReason };

function nullResult(assetId: string, from: IsoDate, to: IsoDate, reason: AttributionReason): Attribution {
  return { assetId, from, to, boundaries: [], rNative: null, rBase: null, rFx: null, reason };
}

export function attribution(input: PortfolioInput, assetId: string, from: IsoDate, to: IsoDate): Attribution {
  if (compareDates(from, to) > 0) throw new KernelError("invalid_input", "attribution needs from ≤ to", { assetId, from, to });
  const asset = input.assets.find((a) => a.id === assetId);
  if (!asset) throw new KernelError("invalid_input", "unknown asset", { assetId });
  const calendar = input.calendars.get(asset.packId);
  if (!calendar) throw new KernelError("invalid_input", "no calendar for pack", { packId: asset.packId });
  const transactions = groupByAsset(input.transactions).get(assetId) ?? [];

  const inside = [...new Set(transactions.map((t) => t.tradeDate))]
    .filter((d) => compareDates(d, from) > 0 && compareDates(d, to) < 0)
    .sort(compareDates);
  const candidates = [from, ...inside, to];

  const legsAt = (lots: ReturnType<typeof lotsAt>, date: IsoDate): Legs => {
    const windowDays = stalenessWindowFor(input, asset.packId, date);
    const ctx: ValuationContext = { market: input.market, calendar, windowDays, series: input.series };
    const value = valueHolding(asset, lots, date, ctx);
    if (value.status === "unpriced") return { reason: value.reason };
    if (value.status === "stale") return { reason: "stale" };
    const fx = resolveFx(input.market, input.series, asset.nativeCurrency, input.baseCurrency, date, windowDays);
    if (fx.status === "unpriced") return { reason: fx.reason };
    if (fx.status === "stale") return { reason: "stale" };
    return { native: value.native.amount, base: value.native.amount.times(fx.rate) };
  };

  const boundaries: IsoDate[] = [];
  let growthNative: KDecimal = ONE;
  let growthBase: KDecimal = ONE;
  for (let i = 1; i < candidates.length; i += 1) {
    const start = candidates[i - 1];
    const end = candidates[i];
    const lots = lotsAt(transactions, start);
    if (lots.length === 0) continue;
    const a = legsAt(lots, start);
    if ("reason" in a) return nullResult(assetId, from, to, a.reason);
    const b = legsAt(lots, end);
    if ("reason" in b) return nullResult(assetId, from, to, b.reason);
    if (boundaries.length === 0) boundaries.push(start);
    boundaries.push(end);
    growthNative = growthNative.times(b.native.div(a.native));
    growthBase = growthBase.times(b.base.div(a.base));
  }
  if (boundaries.length === 0) return nullResult(assetId, from, to, "no_position");

  const rNative = growthNative.minus(ONE);
  const rBase = growthBase.minus(ONE);
  const rFx = growthBase.div(growthNative).minus(ONE);
  return { assetId, from, to, boundaries, rNative, rBase, rFx };
}
