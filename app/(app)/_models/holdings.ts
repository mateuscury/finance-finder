/**
 * The Assets screen's view model (SPEC §9 screen 6, §9.5, §11; MILESTONES.md
 * §4 decisions 58, 59, 60): what the owner holds, per asset — quantity from
 * the FIFO lots, what it cost, what it is worth, what it has gained.
 *
 * Two rules shape it. **Cost is trade cost before fees** (decision 59), so
 * `openCost` and `averageCost` come straight from the kernel and the screen
 * labels them. **An unrealised figure is only shown where the value behind it
 * is one the app trusts** (decision 10 applied to a per-row figure): a stale
 * or unpriced holding shows its quantity and its cost but no gain, because a
 * gain computed off a price the app has already marked as not-current is worse
 * than no gain at all.
 *
 * `lotsAt` throws `oversell` on a ledger whose sells exceed its buys, and
 * `valuePortfolio` therefore throws on the whole portfolio. That is why this
 * model takes `valuation` as nullable and derives each asset's lots inside its
 * own `try`: one broken asset marks its own row and every other row still
 * renders. Only a restored backup can produce such a ledger (SPEC §6).
 *
 * Every figure leaves as a decimal string; the page formats, this decides.
 */
import type { IsoDate } from "@/packs/types";
import { KernelDecimal, toDecimalString, ZERO } from "@/lib/calc/decimal";
import { isKernelError } from "@/lib/calc/errors";
import { averageCost, groupByAsset, lotQuantity, lotsAt, openCost } from "@/lib/calc/positions";
import type { PortfolioValuation } from "@/lib/calc/portfolio";
import type { LedgerTransaction } from "@/lib/calc/types";
import type { AssetListItem } from "@/lib/ledger/queries";
import type { ValueStatusKind } from "@/app/(app)/_components/value-status";

export interface HoldingPrice {
  /** Per unit, native currency — the kernel's `price_native`, an accrued unit value for `accrual` kinds. */
  native: string;
  date: IsoDate;
}

export interface HoldingModelRow {
  assetId: string;
  identifier: string;
  name: string;
  /** The registered kind's label, or null when this build does not know the kind. */
  kindLabel: string | null;
  instrumentKind: string;
  /** The asset's own currency; cost, price and unrealised are all in it. */
  currency: string;
  /** How the kind is valued, so the screen can say "accrues" rather than "unpriced". */
  valuation: AssetListItem["valuation"];
  /** The source that prices this kind — named in the unpriced reason, where there is one. */
  sourceId: string | null;
  /** Open quantity today. "0" for an asset that was never traded or is fully sold. */
  quantity: string;
  /** Null with no open position. Both are trade cost BEFORE fees (decision 59). */
  averageCost: string | null;
  openCost: string | null;
  price: HoldingPrice | null;
  marketValueNative: string | null;
  marketValueBase: string | null;
  /** Only where the value is confident (`ok` / `carried_forward`); native currency. */
  unrealised: { delta: string; rate: string | null } | null;
  /** `ok` for a confident row, `stale` / `unpriced` / `accrues` otherwise (SPEC §11). */
  status: ValueStatusKind;
  /** The date the value is last known good for, on a stale or carried row. */
  statusDate: IsoDate | null;
  /** Why it could not be priced — an `UnpricedReason`, or the source's last error. */
  reason: string | null;
  /** This asset's own ledger is inconsistent; its figures are not computed (SPEC §6). */
  ledgerError: "oversell" | null;
}

export interface HoldingsModel {
  rows: HoldingModelRow[];
  /** The confident total, matching the Overview headline. Null with nothing to value. */
  totalBase: string | null;
  baseCurrency: string;
  /** Open holdings NOT in that total: stale, unpriced, or a broken ledger. */
  outsideTotal: number;
  /** Assets whose own ledger oversells — the count the page warns with. */
  ledgerErrors: number;
}

export interface HoldingsInput {
  /** The kernel at `today` over a latest-price read, or null when it could not be computed. */
  valuation: PortfolioValuation | null;
  transactions: readonly LedgerTransaction[];
  assets: readonly AssetListItem[];
  baseCurrency: string;
  today: IsoDate;
}

/** Ordering: what is worth something, then what needs attention, then what holds nothing. */
const CONFIDENT = 0;
const STALE = 1;
const NEEDS_ATTENTION = 2;
const NOTHING_HELD = 3;

function rankOf(row: HoldingModelRow): number {
  if (row.ledgerError !== null) return NEEDS_ATTENTION;
  if (new KernelDecimal(row.quantity).isZero()) return NOTHING_HELD;
  if (row.status === "stale") return STALE;
  if (row.status === "unpriced") return NEEDS_ATTENTION;
  return CONFIDENT;
}

export function holdingsModel(input: HoldingsInput): HoldingsModel {
  const byAsset = groupByAsset(input.transactions);
  const valued = new Map((input.valuation?.holdings ?? []).map((h) => [h.assetId, h]));
  const excluded = new Map((input.valuation?.excluded ?? []).map((e) => [e.assetId, e]));

  const rows = input.assets.map((asset): HoldingModelRow => {
    const base: HoldingModelRow = {
      assetId: asset.id,
      identifier: asset.identifier,
      name: asset.name,
      kindLabel: asset.kindLabel,
      instrumentKind: asset.instrument_kind,
      currency: asset.native_currency,
      valuation: asset.valuation,
      sourceId: asset.sourceId,
      quantity: "0",
      averageCost: null,
      openCost: null,
      price: null,
      marketValueNative: null,
      marketValueBase: null,
      unrealised: null,
      status: "ok",
      statusDate: null,
      // SPEC §9.4 describes the row of an asset JUST CREATED — which holds
      // nothing yet — saying why it has no price. That row returns from here,
      // before any lot exists, so the source's error belongs on it too.
      reason: asset.sourceError ?? null,
      ledgerError: null,
    };

    let lots;
    try {
      lots = lotsAt(byAsset.get(asset.id) ?? [], input.today);
    } catch (err) {
      // Its own ledger is inconsistent: mark the row, compute nothing for it,
      // and leave every other asset untouched.
      if (isKernelError(err, "oversell")) return { ...base, ledgerError: "oversell", status: "unpriced" };
      throw err;
    }

    const quantity = lotQuantity(lots);
    if (quantity.isZero()) return base;

    const cost = openCost(lots, asset.native_currency).amount;
    const average = averageCost(lots);
    const row: HoldingModelRow = {
      ...base,
      quantity: toDecimalString(quantity),
      openCost: toDecimalString(cost),
      averageCost: average === null ? null : toDecimalString(average),
    };

    const holding = valued.get(asset.id);
    if (!holding) {
      // No row from the kernel: unpriced, or the whole valuation was unavailable.
      //
      // SPEC §9.4: "the reason comes from `ingest_cursors.last_error`". The
      // source's own error is the CAUSE of the missing price, so it wins over
      // the kernel's `no_price`, which only restates the symptom — a holding
      // reading "br.brapi: missing_env:BRAPI_TOKEN" tells the owner what to
      // fix, "no price at or before the date" does not. Accrual kinds carry no
      // source and keep the kernel's reason, which is the only one they have.
      const gone = excluded.get(asset.id);
      const reason = (asset.sourceError ?? null) || (gone && gone.status === "unpriced" ? gone.reason : null);
      const accrues = asset.valuation === "accrual" && input.valuation === null;
      return { ...row, status: accrues ? "accrues" : "unpriced", reason };
    }

    const marketValueNative = holding.marketValueNative.amount;
    const confident = holding.status === "ok" || holding.status === "carried_forward";
    const delta = marketValueNative.minus(cost);
    return {
      ...row,
      price: { native: toDecimalString(holding.priceNative), date: holding.priceDate },
      marketValueNative: toDecimalString(marketValueNative),
      marketValueBase: toDecimalString(holding.marketValueBase.amount),
      // A gain is reported only against a value the app stands behind (SPEC §11).
      unrealised: confident
        ? { delta: toDecimalString(delta), rate: cost.lte(ZERO) ? null : toDecimalString(delta.div(cost)) }
        : null,
      status: holding.status === "ok" ? "ok" : holding.status === "stale" ? "stale" : "carried_forward",
      statusDate: holding.priceDate,
    };
  });

  rows.sort((a, b) => {
    const rank = rankOf(a) - rankOf(b);
    if (rank !== 0) return rank;
    if (rankOf(a) === CONFIDENT && a.marketValueBase !== null && b.marketValueBase !== null) {
      const byValue = new KernelDecimal(b.marketValueBase).comparedTo(new KernelDecimal(a.marketValueBase));
      if (byValue !== 0) return byValue;
    }
    return a.identifier < b.identifier ? -1 : a.identifier > b.identifier ? 1 : 0;
  });

  const open = rows.filter((r) => !new KernelDecimal(r.quantity).isZero() || r.ledgerError !== null);
  return {
    rows,
    totalBase: input.valuation === null ? null : toDecimalString(input.valuation.totalBase.amount),
    baseCurrency: input.valuation?.baseCurrency ?? input.baseCurrency,
    outsideTotal: open.filter((r) => r.status !== "ok" && r.status !== "carried_forward").length,
    ledgerErrors: rows.filter((r) => r.ledgerError !== null).length,
  };
}
