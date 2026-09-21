/**
 * The Overview's view model (SPEC §9 screen 1, §9.3, §9.5), pure over what
 * the page read: the first-run card from row counts, the headline from the
 * kernel's confident total at today, day and period change from the
 * snapshot totals, the sparkline, the allocation by kind, the top movers.
 * Every figure stays a decimal string; ratios are computed by the kernel's
 * Decimal. The page formats; this decides.
 */
import { Decimal } from "decimal.js";
import type { InstrumentKind } from "@/packs/types";
import { KernelDecimal, toDecimalString, ZERO } from "@/lib/calc/decimal";
import type { PortfolioValuation } from "@/lib/calc/portfolio";
import type { HoldingAsset } from "@/lib/calc/types";
import type { LedgerCounts } from "@/lib/ledger/queries";
import type { SettingsRow } from "@/lib/ledger/rows";
import type { SnapshotAssetRow, SnapshotTotal } from "@/lib/ledger/snapshots";

export interface OverviewInput {
  counts: LedgerCounts;
  settings: SettingsRow;
  /** Today's valuation over a latest-price read, or null when there is nothing to value. */
  valuation: PortfolioValuation | null;
  /** Market and NAV assets with no price at all. */
  unpricedAssets: number;
  /** Confident totals in the window the page asked for, ascending. */
  totals: SnapshotTotal[];
  /** The per-asset rows on the last two snapshot dates, for the movers. */
  latestRows: SnapshotAssetRow[];
  previousRows: SnapshotAssetRow[];
  assets: HoldingAsset[];
  /** Display names by asset id. */
  names: Record<string, string>;
}

export type FirstRunStep = "base_currency" | "first_asset" | "first_transaction" | "priced";

export interface OverviewModel {
  /** Null once every step is done (SPEC §9.3: derived from row counts on every render). */
  firstRun: { steps: Array<{ key: FirstRunStep; done: boolean }> } | null;
  headline:
    | { kind: "total"; total: string; currency: string; staleCount: number; carriedCount: number }
    | { kind: "unpriced"; unpriced: number };
  /** From the last two snapshot totals; null below two snapshots. */
  dayChange: { delta: string; rate: string | null; from: string; to: string } | null;
  /** From the first total in the window to the last. */
  periodChange: { delta: string; rate: string | null; from: string; to: string } | null;
  sparkline: Array<{ date: string; total: string; stale: boolean }>;
  allocation: Array<{ kindId: string; kindLabel: string; valueBase: string; share: string }>;
  movers: Array<{ assetId: string; identifier: string; name: string; delta: string; rate: string | null }>;
}

const share2 = (part: Decimal, whole: Decimal) =>
  whole.isZero() ? "0" : toDecimalString(part.div(whole).toDecimalPlaces(6));
const rateOf = (from: Decimal, to: Decimal): string | null =>
  from.lte(0) ? null : toDecimalString(to.div(from).minus(1));

export function firstRunSteps(
  input: Pick<OverviewInput, "counts" | "settings" | "unpricedAssets" | "assets">,
): OverviewModel["firstRun"] {
  const { counts, settings } = input;
  const touched = settings.updated_at !== "" && settings.updated_at > settings.created_at;
  const priceable = input.assets.filter(
    (a) => a.instrumentKind.valuation.kind === "market_price" || a.instrumentKind.valuation.kind === "nav_unit_price",
  ).length;
  const steps: Array<{ key: FirstRunStep; done: boolean }> = [
    { key: "base_currency", done: touched || counts.transactions > 0 },
    { key: "first_asset", done: counts.assets > 0 },
    { key: "first_transaction", done: counts.transactions > 0 },
    // "Every asset has ≥ 1 prices row" — accrual kinds have none and need none.
    { key: "priced", done: counts.assets > 0 && (priceable === 0 || input.unpricedAssets === 0) },
  ];
  return steps.every((s) => s.done) ? null : { steps };
}

export function overviewModel(input: OverviewInput): OverviewModel {
  const { valuation, totals } = input;
  const v = valuation;
  const headline: OverviewModel["headline"] =
    v && v.holdings.length > 0
      ? {
          kind: "total",
          total: v.totalBase.toString(),
          currency: v.baseCurrency,
          staleCount: v.excluded.filter((e) => e.status === "stale").length,
          carriedCount: v.holdings.filter((h) => h.carriedForward).length,
        }
      : { kind: "unpriced", unpriced: input.unpricedAssets };

  const last = totals.at(-1);
  const prev = totals.at(-2);
  const first = totals[0];
  const change = (a: SnapshotTotal, b: SnapshotTotal) => {
    const from = new KernelDecimal(a.totalBase);
    const to = new KernelDecimal(b.totalBase);
    return { delta: toDecimalString(to.minus(from)), rate: rateOf(from, to), from: a.date, to: b.date };
  };
  const dayChange = last && prev ? change(prev, last) : null;
  const periodChange = last && first && first !== last ? change(first, last) : null;

  const sparkline = totals.map((t) => ({ date: t.date, total: t.totalBase, stale: t.staleRows > 0 }));

  // Allocation by instrument kind, from today's confident holdings.
  const kinds = new Map<string, { kind: InstrumentKind; value: Decimal }>();
  if (v) {
    const byId = new Map(input.assets.map((a) => [a.id, a]));
    for (const h of v.holdings) {
      if (h.status === "stale") continue;
      const asset = byId.get(h.assetId);
      if (!asset) continue;
      const entry = kinds.get(asset.instrumentKind.id) ?? { kind: asset.instrumentKind, value: ZERO };
      kinds.set(asset.instrumentKind.id, { kind: entry.kind, value: entry.value.plus(h.marketValueBase.amount) });
    }
  }
  const whole = [...kinds.values()].reduce((sum, k) => sum.plus(k.value), ZERO);
  const allocation = [...kinds.values()]
    .sort((a, b) => b.value.comparedTo(a.value))
    .map((k) => ({
      kindId: k.kind.id,
      kindLabel: k.kind.label,
      valueBase: toDecimalString(k.value),
      share: share2(k.value, whole),
    }));

  // Top movers: per-asset change between the last two snapshot dates.
  const prevById = new Map(input.previousRows.map((r) => [r.assetId, r]));
  const assetById = new Map(input.assets.map((a) => [a.id, a]));
  const movers = input.latestRows
    .flatMap((r) => {
      const p = prevById.get(r.assetId);
      const a = assetById.get(r.assetId);
      if (!p || !a || r.status === "stale" || p.status === "stale") return [];
      const from = new KernelDecimal(p.marketValueBase);
      const to = new KernelDecimal(r.marketValueBase);
      return [
        {
          assetId: r.assetId,
          identifier: a.identifier,
          name: input.names[r.assetId] ?? a.identifier,
          delta: to.minus(from),
          rate: rateOf(from, to),
        },
      ];
    })
    .sort((x, y) => y.delta.abs().comparedTo(x.delta.abs()))
    .slice(0, 5)
    .map((m) => ({ ...m, delta: toDecimalString(m.delta) }));

  return { firstRun: firstRunSteps(input), headline, dayChange, periodChange, sparkline, allocation, movers };
}
