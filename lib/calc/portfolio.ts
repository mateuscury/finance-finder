/**
 * The portfolio builder — the rows `portfolio_snapshots` stores, computed
 * from the ledger, prices and series as of one date (docs/milestone-2-plan.md
 * Phase 3; MILESTONES.md §2 decisions 10 and 17).
 *
 * Per asset with open lots: `valueHolding` under the ASSET's pack calendar and
 * staleness window, then `resolveFx` under the same window. A row exists only
 * when both legs have a value; its `status` is the worse leg and
 * `carriedForward` is true whenever the row was not built on fresh inputs.
 * `totalBase` sums `ok` + `carried_forward` only. `stale` rows are kept (with
 * their last-known value, so a screen can show them) and listed in `excluded`
 * beside the assets that could not be priced at all. A fully sold asset
 * produces nothing.
 */
import type { CurrencyCode, IsoDate, MarketCalendar, SeriesDescriptor } from "@/packs/types";
import { stalenessWindowDays } from "./calendar";
import type { KDecimal } from "./decimal";
import { yearOf } from "./dates";
import { KernelError } from "./errors";
import { resolveFx } from "./fx";
import { Money } from "./money";
import { groupByAsset, lotQuantity, lotsAt } from "./positions";
import { worseOf, type Observed, type UnpricedReason, type ValueStatus } from "./staleness";
import type { HoldingAsset, LedgerTransaction, MarketData } from "./types";
import { valueHolding, type ValuationContext } from "./valuation";

export interface PortfolioInput {
  baseCurrency: CurrencyCode;
  assets: readonly HoldingAsset[];
  transactions: readonly LedgerTransaction[];
  market: MarketData;
  /** Pack id → its calendar. The kernel cannot import the registry; the caller resolves it. */
  calendars: ReadonlyMap<string, MarketCalendar>;
  /** Every series descriptor in scope (own packs and their dependencies). */
  series: readonly SeriesDescriptor[];
}

export interface HoldingRow {
  assetId: string;
  status: ValueStatus;
  /** True unless both the price and the FX leg were observed on `asOf`. */
  carriedForward: boolean;
  quantity: KDecimal;
  /** Per unit, native currency (`price_native`). */
  priceNative: KDecimal;
  priceDate: IsoDate;
  marketValueNative: Money;
  /** Null when native equals base (`fx_rate`). */
  fxRate: KDecimal | null;
  fxDate: IsoDate | null;
  marketValueBase: Money;
}

export type ExcludedHolding =
  | { assetId: string; status: "stale"; lastKnownBase: Money; priceDate: IsoDate; fxDate: IsoDate | null }
  | { assetId: string; status: "unpriced"; reason: UnpricedReason };

export interface PortfolioValuation {
  asOf: IsoDate;
  baseCurrency: CurrencyCode;
  /** `ok`, `carried_forward` and `stale` rows, in `assets` order. */
  holdings: readonly HoldingRow[];
  /** Confident total: `ok` + `carried_forward` rows only. */
  totalBase: Money;
  excluded: readonly ExcludedHolding[];
}

function calendarFor(input: PortfolioInput, packId: string): MarketCalendar {
  const calendar = input.calendars.get(packId);
  if (!calendar) throw new KernelError("invalid_input", "no calendar for pack", { packId });
  return calendar;
}

/** The staleness window a pack's holdings are judged under on `date`. */
export function stalenessWindowFor(input: PortfolioInput, packId: string, date: IsoDate): number {
  return stalenessWindowDays(calendarFor(input, packId), yearOf(date));
}

/**
 * Converts `money` to the base currency as of `date` under `packId`'s window
 * — the one converter every base-currency figure goes through (decision 15).
 * `observedOn` is the FX date, or `date` itself when no conversion was needed.
 */
export function toBase(input: PortfolioInput, money: Money, date: IsoDate, packId: string): Observed<Money> {
  const fx = resolveFx(input.market, input.series, money.currency, input.baseCurrency, date, stalenessWindowFor(input, packId, date));
  if (fx.status === "unpriced") return fx;
  if (fx.status === "stale") {
    return { status: "stale", lastKnown: Money.of(money.amount.times(fx.lastKnown), input.baseCurrency), observedOn: fx.fxDate };
  }
  return { status: fx.status, value: Money.of(money.amount.times(fx.rate), input.baseCurrency), observedOn: fx.fxDate ?? date };
}

export function valuePortfolio(input: PortfolioInput, asOf: IsoDate): PortfolioValuation {
  const byAsset = groupByAsset(input.transactions);
  const holdings: HoldingRow[] = [];
  const excluded: ExcludedHolding[] = [];
  let totalBase = Money.zero(input.baseCurrency);

  for (const asset of input.assets) {
    const lots = lotsAt(byAsset.get(asset.id) ?? [], asOf);
    if (lots.length === 0) continue;

    const calendar = calendarFor(input, asset.packId);
    const windowDays = stalenessWindowDays(calendar, yearOf(asOf));
    const ctx: ValuationContext = { market: input.market, calendar, windowDays, series: input.series };

    const value = valueHolding(asset, lots, asOf, ctx);
    if (value.status === "unpriced") {
      excluded.push({ assetId: asset.id, status: "unpriced", reason: value.reason });
      continue;
    }
    const fx = resolveFx(input.market, input.series, asset.nativeCurrency, input.baseCurrency, asOf, windowDays);
    if (fx.status === "unpriced") {
      excluded.push({ assetId: asset.id, status: "unpriced", reason: fx.reason });
      continue;
    }

    const native = value.status === "stale" ? value.lastKnown : value.native;
    const rate = fx.status === "stale" ? fx.lastKnown : fx.rate;
    const base = Money.of(native.amount.times(rate), input.baseCurrency);
    const status = worseOf(value.status, fx.status);
    const sameCurrency = asset.nativeCurrency === input.baseCurrency;
    holdings.push({
      assetId: asset.id,
      status,
      carriedForward: status !== "ok",
      quantity: lotQuantity(lots),
      priceNative: value.unitValue,
      priceDate: value.priceDate,
      marketValueNative: native,
      fxRate: sameCurrency ? null : rate,
      fxDate: fx.fxDate,
      marketValueBase: base,
    });
    if (status === "stale") {
      excluded.push({ assetId: asset.id, status: "stale", lastKnownBase: base, priceDate: value.priceDate, fxDate: fx.fxDate });
    } else {
      totalBase = totalBase.add(base);
    }
  }

  return { asOf, baseCurrency: input.baseCurrency, holdings, totalBase, excluded };
}
