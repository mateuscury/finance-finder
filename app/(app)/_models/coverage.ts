/**
 * Which snapshot dates are valuation points (MILESTONES.md §4 decision 53,
 * as implemented): a date is a point only when every asset with open lots
 * on it is confidently valued — no stale row, and no holding missing a row
 * because it was unpriced (an unpriced holding leaves no row at all, so the
 * row count is compared with the holdings open on that date). A date that
 * fails is listed, drawn as a gap, and never chained: its total omits a
 * holding and would read as a move that never happened.
 */
import { groupByAsset, quantityAt } from "@/lib/calc/positions";
import type { LedgerTransaction } from "@/lib/calc/types";
import type { SnapshotTotal } from "@/lib/ledger/snapshots";

export interface CoveredTotal extends SnapshotTotal {
  /** Assets with open lots on the date. */
  openHoldings: number;
  /** Every open holding is confidently valued. */
  complete: boolean;
}

export function coverTotals(
  totals: readonly SnapshotTotal[],
  transactions: readonly LedgerTransaction[],
): CoveredTotal[] {
  const byAsset = [...groupByAsset(transactions).values()];
  return totals.map((t) => {
    const openHoldings = byAsset.filter((txns) => quantityAt(txns, t.date).gt(0)).length;
    return { ...t, openHoldings, complete: t.staleRows === 0 && t.rows >= openHoldings };
  });
}
