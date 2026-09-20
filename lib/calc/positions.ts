/**
 * Positions — lots derived from the ledger, never stored
 * (docs/milestone-2-plan.md "Positions"; ARCHITECTURE §4.1).
 *
 * Transactions are processed in `(tradeDate, rank, id)` order with
 * `buy < dividend = interest = fee < sell`, so a same-day round trip never
 * oversells. A buy opens a lot; a sell consumes lots FIFO; the other types
 * touch no lot. A sell beyond the open quantity throws `oversell` — the
 * kernel never carries a negative position.
 *
 * Lots are kept, not just a quantity, because `accrual` values each lot from
 * its own purchase date.
 */
import type { IsoDate } from "@/packs/types";
import { ZERO, parseDecimal, type KDecimal } from "./decimal";
import { compareDates, inWindow } from "./dates";
import { KernelError } from "./errors";
import { Money } from "./money";
import type { LedgerTransaction, TransactionType } from "./types";

export interface Lot {
  /** Trade date of the buy that opened it. */
  openedOn: IsoDate;
  /** Remaining quantity after FIFO consumption; always > 0. */
  quantity: KDecimal;
  unitPrice: KDecimal;
  currency: string;
  /** The buy transaction, for traceability. */
  transactionId: string;
}

const RANK: Record<TransactionType, number> = { buy: 0, dividend: 1, interest: 1, fee: 1, sell: 2 };

function compareTransactions(a: LedgerTransaction, b: LedgerTransaction): number {
  const byDate = compareDates(a.tradeDate, b.tradeDate);
  if (byDate !== 0) return byDate;
  const byRank = RANK[a.type] - RANK[b.type];
  if (byRank !== 0) return byRank;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Validates one row's shape against the ledger's own check constraints. */
function parsed(t: LedgerTransaction): { quantity: KDecimal; unitPrice: KDecimal; fees: KDecimal } {
  const quantity = parseDecimal(t.quantity, "quantity");
  const unitPrice = parseDecimal(t.unitPrice, "unitPrice");
  const fees = parseDecimal(t.fees, "fees");
  const details = { transactionId: t.id, assetId: t.assetId, date: t.tradeDate };
  const signOk =
    (t.type === "buy" && quantity.gt(0)) ||
    (t.type === "sell" && quantity.lt(0)) ||
    ((t.type === "dividend" || t.type === "interest" || t.type === "fee") && quantity.isZero());
  if (!signOk) throw new KernelError("invalid_input", `quantity sign does not match type ${t.type}`, details);
  if (!unitPrice.gt(0)) throw new KernelError("invalid_input", "unitPrice must be positive", details);
  if (fees.lt(0)) throw new KernelError("invalid_input", "fees must not be negative", details);
  return { quantity, unitPrice, fees };
}

/** One asset's rows per asset id, in input order; an asset with no rows has no entry. */
export function groupByAsset(transactions: readonly LedgerTransaction[]): ReadonlyMap<string, readonly LedgerTransaction[]> {
  const groups = new Map<string, LedgerTransaction[]>();
  for (const t of transactions) {
    const rows = groups.get(t.assetId);
    if (rows) rows.push(t);
    else groups.set(t.assetId, [t]);
  }
  return groups;
}

/** Ledger rows in processing order. Pure; the input is not mutated. */
export function sortLedger(transactions: readonly LedgerTransaction[]): LedgerTransaction[] {
  return [...transactions].sort(compareTransactions);
}

/**
 * Open lots of ONE asset as of `date` (transactions dated ≤ `date`), FIFO
 * order. `transactions` may be in any order and must all share an asset id.
 */
export function lotsAt(transactions: readonly LedgerTransaction[], date: IsoDate): readonly Lot[] {
  const lots: Lot[] = [];
  let assetId: string | null = null;
  for (const t of sortLedger(transactions)) {
    if (assetId === null) assetId = t.assetId;
    else if (t.assetId !== assetId) {
      throw new KernelError("invalid_input", "lotsAt takes one asset's transactions", { assetId, other: t.assetId });
    }
    if (compareDates(t.tradeDate, date) > 0) break;
    const { quantity, unitPrice } = parsed(t);
    if (t.type === "buy") {
      lots.push({ openedOn: t.tradeDate, quantity, unitPrice, currency: t.currency, transactionId: t.id });
    } else if (t.type === "sell") {
      let remaining = quantity.abs();
      while (remaining.gt(0)) {
        const head = lots[0];
        if (!head) {
          throw new KernelError("oversell", "sell exceeds the open position", {
            assetId: t.assetId,
            date: t.tradeDate,
            transactionId: t.id,
          });
        }
        if (head.quantity.lte(remaining)) {
          remaining = remaining.minus(head.quantity);
          lots.shift();
        } else {
          lots[0] = { ...head, quantity: head.quantity.minus(remaining) };
          remaining = ZERO;
        }
      }
    }
    // dividend / interest / fee: no lot is touched.
  }
  return Object.freeze(lots);
}

/** Sum of the lots' quantities. */
export function lotQuantity(lots: readonly Lot[]): KDecimal {
  return lots.reduce((sum, lot) => sum.plus(lot.quantity), ZERO);
}

/** Sum of open lot quantities as of `date`. */
export function quantityAt(transactions: readonly LedgerTransaction[], date: IsoDate): KDecimal {
  return lotQuantity(lotsAt(transactions, date));
}

/** One transaction's signed cash effect: money put in is positive, money taken out negative. */
export interface InvestedFlow {
  transactionId: string;
  date: IsoDate;
  amount: Money;
}

/**
 * The money put into ONE asset over `(from, to]`, one entry per transaction,
 * in each transaction's own currency:
 *   buy      → + quantity × unitPrice + fees
 *   sell     → − (|quantity| × unitPrice − fees)
 *   dividend / interest → − unitPrice (the cash amount)
 *   fee      → + unitPrice (the cash amount).
 * Contribution converts each entry at its own date (MILESTONES.md §2
 * decision 15); `netInvested` sums them in one currency.
 */
export function investedFlows(transactions: readonly LedgerTransaction[], from: IsoDate, to: IsoDate): readonly InvestedFlow[] {
  const flows: InvestedFlow[] = [];
  for (const t of sortLedger(transactions)) {
    if (!inWindow(t.tradeDate, from, to)) continue;
    const { quantity, unitPrice, fees } = parsed(t);
    let amount: KDecimal;
    switch (t.type) {
      case "buy":
        amount = quantity.times(unitPrice).plus(fees);
        break;
      case "sell":
        amount = quantity.abs().times(unitPrice).minus(fees).negated();
        break;
      case "dividend":
      case "interest":
        amount = unitPrice.negated();
        break;
      case "fee":
        amount = unitPrice;
        break;
    }
    flows.push({ transactionId: t.id, date: t.tradeDate, amount: Money.of(amount, t.currency) });
  }
  return flows;
}

/**
 * Net money put into ONE asset over `(from, to]`, in `currency`: the sum of
 * `investedFlows`. A transaction in another currency is `currency_mismatch`.
 */
export function netInvested(
  transactions: readonly LedgerTransaction[],
  currency: string,
  from: IsoDate,
  to: IsoDate,
): Money {
  let total = Money.zero(currency);
  // Money.add enforces the currency: a row in another currency throws.
  for (const flow of investedFlows(transactions, from, to)) total = total.add(flow.amount);
  return total;
}
