/**
 * Kernel input rows and the read-only market-data lookup
 * (docs/milestone-2-plan.md Phase 1).
 *
 * Every money-shaped field is a DECIMAL STRING. Rows are the ledger as the
 * store or the golden fixture hands it over; the kernel parses each value at
 * the point of use and throws `invalid_decimal` rather than coerce. Nothing in
 * this file knows about a database: the store's job is to produce these rows
 * with `numeric` cast to text (plan "Ordering constraints").
 */
import type { CurrencyCode, DecimalString, InstrumentKind, IsoDate } from "@/packs/types";
import { isDecimalString } from "./decimal";
import { isIsoDate } from "./dates";
import { KernelError } from "./errors";

/** Mirrors `public.txn_type`. */
export type TransactionType = "buy" | "sell" | "dividend" | "interest" | "fee";

export interface LedgerTransaction {
  id: string;
  assetId: string;
  tradeDate: IsoDate;
  type: TransactionType;
  /** Signed: buy positive, sell negative, "0" for dividend / interest / fee. */
  quantity: DecimalString;
  /** Per unit in `currency`; for dividend / interest / fee it is the cash amount. */
  unitPrice: DecimalString;
  currency: CurrencyCode;
  fees: DecimalString;
  /** Native→base on the trade day; null when native equals base. Display only. */
  fxRate: DecimalString | null;
}

/** An external deposit (positive) or withdrawal (negative), in base currency. */
export interface ExternalCashFlow {
  id: string;
  date: IsoDate;
  amount: DecimalString;
  currency: CurrencyCode;
}

/** An asset row with its `instrument_kind` already resolved against the registry. */
export interface HoldingAsset {
  id: string;
  packId: string;
  instrumentKind: InstrumentKind;
  identifier: string;
  nativeCurrency: CurrencyCode;
  /** Validated by `instrumentKind.metadataSchema` where it is consumed. */
  metadata: unknown;
}

export interface PriceObservation {
  assetId: string;
  date: IsoDate;
  price: DecimalString;
  currency: CurrencyCode;
  /** 'manual' or a pack source id. */
  sourceId: string;
}

export interface SeriesObservation {
  seriesId: string;
  date: IsoDate;
  value: DecimalString;
  /** 0 for every scalar series; a declared tenor for yield-curve points. */
  tenorDays: number;
}

/**
 * Read-only, date-indexed view over prices and series. Built once per
 * valuation run so every "latest observation at or before `date`" is a binary
 * search rather than a scan.
 */
export interface MarketData {
  /** Ascending by date. Empty when the asset has no prices. */
  pricesFor(assetId: string): readonly PriceObservation[];
  latestPriceAtOrBefore(assetId: string, date: IsoDate): PriceObservation | null;
  /** Ascending by (date, tenorDays). Empty when the series is unknown. */
  seriesFor(seriesId: string): readonly SeriesObservation[];
  /** Latest observation date ≤ `date` for the series, across all tenors. */
  latestDateAtOrBefore(seriesId: string, date: IsoDate): IsoDate | null;
  /** Every point dated exactly `date` (one for a scalar series, one per tenor for a curve). */
  pointsOn(seriesId: string, date: IsoDate): readonly SeriesObservation[];
  /** For scalar series: the `tenorDays === 0` point on the latest date ≤ `date`. */
  latestScalarAtOrBefore(seriesId: string, date: IsoDate): SeriesObservation | null;
}

function validatePrice(p: PriceObservation, i: number): void {
  if (!isIsoDate(p.date)) throw new KernelError("invalid_date", "price date", { index: i, assetId: p.assetId });
  if (!isDecimalString(p.price)) throw new KernelError("invalid_decimal", "price", { index: i, assetId: p.assetId });
}

function validateSeries(s: SeriesObservation, i: number): void {
  if (!isIsoDate(s.date)) throw new KernelError("invalid_date", "series date", { index: i, seriesId: s.seriesId });
  if (!isDecimalString(s.value)) throw new KernelError("invalid_decimal", "series value", { index: i, seriesId: s.seriesId });
  if (!Number.isInteger(s.tenorDays) || s.tenorDays < 0) {
    throw new KernelError("invalid_input", "tenorDays must be a non-negative integer", { index: i, seriesId: s.seriesId });
  }
}

/** Index of the last element whose `date` ≤ `date`, or −1. Array ascending by date. */
function lastIndexAtOrBefore(rows: readonly { date: string }[], date: string): number {
  let lo = 0;
  let hi = rows.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (rows[mid].date <= date) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

export function buildMarketData(
  prices: readonly PriceObservation[],
  series: readonly SeriesObservation[],
): MarketData {
  const priceIndex = new Map<string, PriceObservation[]>();
  prices.forEach((p, i) => {
    validatePrice(p, i);
    const rows = priceIndex.get(p.assetId);
    if (rows) rows.push(p);
    else priceIndex.set(p.assetId, [p]);
  });
  for (const [assetId, rows] of priceIndex) {
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    for (let i = 1; i < rows.length; i += 1) {
      if (rows[i].date === rows[i - 1].date) {
        throw new KernelError("invalid_input", "two prices on one date", { assetId, date: rows[i].date });
      }
    }
    Object.freeze(rows);
  }

  const seriesIndex = new Map<string, SeriesObservation[]>();
  // Distinct dates per series, ascending, for the binary search.
  const seriesDates = new Map<string, string[]>();
  series.forEach((s, i) => {
    validateSeries(s, i);
    const rows = seriesIndex.get(s.seriesId);
    if (rows) rows.push(s);
    else seriesIndex.set(s.seriesId, [s]);
  });
  for (const [seriesId, rows] of seriesIndex) {
    rows.sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : a.tenorDays < b.tenorDays ? -1 : a.tenorDays > b.tenorDays ? 1 : 0,
    );
    const dates: string[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      if (i > 0 && rows[i].date === rows[i - 1].date && rows[i].tenorDays === rows[i - 1].tenorDays) {
        throw new KernelError("invalid_input", "two series points on one date and tenor", {
          seriesId,
          date: rows[i].date,
          tenorDays: rows[i].tenorDays,
        });
      }
      if (i === 0 || rows[i].date !== rows[i - 1].date) dates.push(rows[i].date);
    }
    seriesDates.set(seriesId, dates);
    Object.freeze(rows);
  }

  const none: readonly never[] = Object.freeze([]);

  return {
    pricesFor: (assetId) => priceIndex.get(assetId) ?? none,
    latestPriceAtOrBefore: (assetId, date) => {
      const rows = priceIndex.get(assetId);
      if (!rows) return null;
      const i = lastIndexAtOrBefore(rows, date);
      return i < 0 ? null : rows[i];
    },
    seriesFor: (seriesId) => seriesIndex.get(seriesId) ?? none,
    latestDateAtOrBefore: (seriesId, date) => {
      const dates = seriesDates.get(seriesId);
      if (!dates) return null;
      let lo = 0;
      let hi = dates.length - 1;
      let found: string | null = null;
      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (dates[mid] <= date) {
          found = dates[mid];
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }
      return found;
    },
    pointsOn: (seriesId, date) => {
      const rows = seriesIndex.get(seriesId);
      if (!rows) return none;
      // Rows are sorted by date; the run for one date is contiguous.
      const end = lastIndexAtOrBefore(rows, date);
      if (end < 0 || rows[end].date !== date) return none;
      let start = end;
      while (start > 0 && rows[start - 1].date === date) start -= 1;
      return rows.slice(start, end + 1);
    },
    latestScalarAtOrBefore: (seriesId, date) => {
      const rows = seriesIndex.get(seriesId);
      if (!rows) return null;
      const i = lastIndexAtOrBefore(rows, date);
      if (i < 0) return null;
      // Walk back within that date to the tenor-0 point (first of the run).
      for (let j = i; j >= 0 && rows[j].date === rows[i].date; j -= 1) {
        if (rows[j].tenorDays === 0) return rows[j];
      }
      return null;
    },
  };
}
