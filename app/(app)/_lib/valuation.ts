/**
 * `valuePortfolio`, for a screen (SPEC §6, §11; MILESTONES.md §4 decision 58).
 *
 * The kernel refuses to value a ledger whose sells exceed its buys: `lotsAt`
 * throws `oversell`, and because `valuePortfolio` walks every asset, ONE
 * broken asset makes the whole portfolio unvaluable. Unwrapped, that reaches
 * the error boundary and the owner sees "something went wrong" on every
 * analysis screen with no way to tell which asset is wrong.
 *
 * So a screen asks through here instead: an inconsistent ledger comes back as
 * a result naming the assets at fault, and the screen says so where its
 * figures would have been. Writes are guarded (`lib/ledger/transactions.ts`,
 * the import preview), so only a restored backup can produce one.
 */
import type { IsoDate } from "@/packs/types";
import { isKernelError } from "@/lib/calc/errors";
import { valuePortfolio, type PortfolioInput, type PortfolioValuation } from "@/lib/calc/portfolio";
import { groupByAsset, lotsAt } from "@/lib/calc/positions";

export interface LedgerValuation {
  /** The kernel's valuation; null when there is nothing to value, or the ledger is inconsistent. */
  valuation: PortfolioValuation | null;
  /** Asset ids whose own transactions oversell. Empty when the ledger is sound. */
  oversold: string[];
}

export function valueLedger(input: PortfolioInput, asOf: IsoDate): LedgerValuation {
  if (input.assets.length === 0) return { valuation: null, oversold: [] };
  try {
    return { valuation: valuePortfolio(input, asOf), oversold: [] };
  } catch (err) {
    if (!isKernelError(err, "oversell")) throw err;
    // Rare (only a restored backup reaches here), so the second pass costs
    // nothing in the normal case and buys the owner the asset ids.
    const byAsset = groupByAsset(input.transactions);
    const oversold = input.assets
      .filter((asset) => {
        try {
          lotsAt(byAsset.get(asset.id) ?? [], asOf);
          return false;
        } catch (inner) {
          if (isKernelError(inner, "oversell")) return true;
          throw inner;
        }
      })
      .map((asset) => asset.id);
    return { valuation: null, oversold };
  }
}
