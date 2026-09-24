/**
 * Which snapshot dates are valuation points (MILESTONES.md §4 decision 53,
 * as implemented): a date is a point only when every asset with open lots
 * on it is confidently valued — no stale row, and no holding missing a row
 * because it was unpriced (an unpriced holding leaves no row at all, so the
 * row count is compared with the holdings open on that date). A date that
 * fails is listed, drawn as a gap, and never chained: its total omits a
 * holding and would read as a move that never happened.
 */
import { compareDates } from "@/lib/calc/dates";
import { groupByAsset, quantityAt } from "@/lib/calc/positions";
import type { IsoDate } from "@/packs/types";
import type { LedgerTransaction } from "@/lib/calc/types";
import type { SnapshotTotal } from "@/lib/ledger/snapshots";

export interface CoveredTotal extends SnapshotTotal {
  /** Assets with open lots on the date. */
  openHoldings: number;
  /** Every open holding is confidently valued. */
  complete: boolean;
}

/**
 * One asset's open/closed state over time. An asset's quantity can only
 * change on a date it traded, so the FIFO walk runs once per traded date and
 * every snapshot date in between reads the answer off this timeline.
 *
 * Measured (P6-U1, `docs/performance-budgets.md`): asking the kernel per
 * (date × asset) cost 2.9 s over a five-year ledger — 1,256 snapshot dates
 * × 20 assets, each re-walking that asset's whole history. The input order
 * is not assumed: callers pass a filtered slice, and one test passes dates
 * out of order.
 */
interface Timeline {
  dates: IsoDate[];
  open: boolean[];
}

function timelineOf(transactions: readonly LedgerTransaction[]): Timeline {
  const dates = [...new Set(transactions.map((t) => t.tradeDate))].sort(compareDates);
  return { dates, open: dates.map((d) => quantityAt(transactions, d).gt(0)) };
}

/** Whether the asset held anything on `date`: the state left by its last trade on or before it. */
function openOn(timeline: Timeline, date: IsoDate): boolean {
  let lo = 0;
  let hi = timeline.dates.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (compareDates(timeline.dates[mid], date) <= 0) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 && timeline.open[found];
}

export function coverTotals(
  totals: readonly SnapshotTotal[],
  transactions: readonly LedgerTransaction[],
): CoveredTotal[] {
  const timelines = [...groupByAsset(transactions).values()].map(timelineOf);
  return totals.map((t) => {
    const openHoldings = timelines.filter((timeline) => openOn(timeline, t.date)).length;
    return { ...t, openHoldings, complete: t.staleRows === 0 && t.rows >= openHoldings };
  });
}
