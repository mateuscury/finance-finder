/**
 * The Maturities view model (SPEC §9 screen 5; US-012), pure over the
 * ledger read and today's valuation. A holding is on the ladder when its
 * kind declares `maturity` (decision 38) and it has open lots today. The
 * contracted value at maturity is computed for plain-rate accruals only —
 * `valueHolding` at the maturity date needs no future series — and never
 * guessed for indexed kinds. A holding still open past its maturity is
 * marked: the ledger, not the metadata, says whether the money is still
 * invested (§2 decision 14), so a missing redemption is shown, not hidden.
 */
import type { IsoDate } from "@/packs/types";
import { daysBetween } from "@/lib/calc/dates";
import type { ExcludedHolding, HoldingRow, PortfolioValuation } from "@/lib/calc/portfolio";
import { stalenessWindowFor, type PortfolioInput } from "@/lib/calc/portfolio";
import { groupByAsset, lotsAt } from "@/lib/calc/positions";
import { valueHolding } from "@/lib/calc/valuation";
import type { LedgerRead } from "@/lib/ledger/rows";
import { hasMaturity, isPlainRateAccrual, maturityOf } from "@/lib/ledger/maturity";

export interface MaturityRow {
  assetId: string;
  identifier: string;
  name: string;
  kindLabel: string;
  maturity: IsoDate;
  /** Calendar days from today; negative when matured. */
  daysToGo: number;
  matured: boolean;
  /** Today's row, or why there is none. */
  current: { kind: "row"; row: HoldingRow } | { kind: "excluded"; entry: ExcludedHolding } | { kind: "none" };
  /** Native amount at maturity for a plain-rate accrual; null otherwise. */
  contracted: string | null;
  /** The value at maturity depends on an index's path: no projection. */
  indexed: boolean;
  nativeCurrency: string;
}

export interface MaturitiesModel {
  rows: MaturityRow[];
  /** Grouped by month of maturity, ascending. */
  timeline: Array<{ month: IsoDate; rows: MaturityRow[] }>;
  empty: boolean;
}

export function maturitiesModel(input: {
  read: LedgerRead;
  input: PortfolioInput;
  today: IsoDate;
  valuation: PortfolioValuation | null;
}): MaturitiesModel {
  const { read, today, valuation } = input;
  const byAsset = groupByAsset(read.transactions);
  const rowById = new Map(valuation?.holdings.map((h) => [h.assetId, h]) ?? []);
  const excludedById = new Map(valuation?.excluded.map((e) => [e.assetId, e]) ?? []);
  const rows: MaturityRow[] = [];
  for (const asset of read.assets) {
    if (!hasMaturity(asset.instrumentKind)) continue;
    const maturity = maturityOf(asset);
    if (maturity === null) continue;
    const lots = lotsAt(byAsset.get(asset.id) ?? [], today);
    if (lots.length === 0) continue;
    const plain = isPlainRateAccrual(asset.instrumentKind);
    let contracted: string | null = null;
    if (plain) {
      const calendar = input.input.calendars.get(asset.packId);
      if (calendar) {
        const v = valueHolding(asset, lots, maturity, {
          market: input.input.market,
          calendar,
          windowDays: stalenessWindowFor(input.input, asset.packId, maturity),
          series: input.input.series,
        });
        if (v.status === "ok" || v.status === "carried_forward") contracted = v.native.amount.toString();
      }
    }
    const row = rowById.get(asset.id);
    const excluded = excludedById.get(asset.id);
    rows.push({
      assetId: asset.id,
      identifier: asset.identifier,
      name: read.names[asset.id] ?? asset.identifier,
      kindLabel: asset.instrumentKind.label,
      maturity,
      daysToGo: daysBetween(today, maturity),
      matured: maturity < today,
      current: row ? { kind: "row", row } : excluded ? { kind: "excluded", entry: excluded } : { kind: "none" },
      contracted,
      indexed: asset.instrumentKind.valuation.kind === "accrual" && !plain,
      nativeCurrency: asset.nativeCurrency,
    });
  }
  rows.sort((a, b) =>
    a.maturity < b.maturity ? -1 : a.maturity > b.maturity ? 1 : a.identifier < b.identifier ? -1 : 1,
  );
  const months = new Map<string, MaturityRow[]>();
  for (const r of rows) {
    const month = `${r.maturity.slice(0, 7)}-01`;
    (months.get(month) ?? months.set(month, []).get(month)!).push(r);
  }
  return {
    rows,
    timeline: [...months.entries()].map(([month, rs]) => ({ month, rows: rs })),
    empty: rows.length === 0,
  };
}
