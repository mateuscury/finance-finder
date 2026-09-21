import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { KernelDecimal } from "@/lib/calc/decimal";
import { valuePortfolio } from "@/lib/calc/portfolio";
import { toPortfolioInput } from "@/lib/ledger/rows";
import type { SnapshotAssetRow, SnapshotTotal } from "@/lib/ledger/snapshots";
import { goldenLedgerRead, loadGoldenFixture } from "@/lib/testing/golden";
import { overviewModel, type OverviewInput } from "./overview";

const { fixture, expected } = loadGoldenFixture();
const read = goldenLedgerRead(fixture, PACKS);
const valuations = Object.entries(expected.valuations as Record<string, string>)
  .map(([date, value]) => ({ date, value }))
  .sort((a, b) => (a.date < b.date ? -1 : 1));

/** The golden's per-date totals as the `snapshot_totals` view would report them. */
const totals: SnapshotTotal[] = valuations.map((v) => ({
  date: v.date,
  baseCurrency: "BRL",
  totalBase: v.value,
  rows: 7,
  staleRows: 0,
  carriedRows: 0,
}));

/** Per-asset rows on a golden date, from the kernel — what the snapshot job writes. */
function rowsAt(date: string): SnapshotAssetRow[] {
  return valuePortfolio(toPortfolioInput(read), date).holdings.map((h) => ({
    assetId: h.assetId,
    date,
    quantity: h.quantity.toString(),
    priceNative: h.priceNative.toString(),
    priceDate: h.priceDate,
    fxRate: null,
    fxDate: null,
    baseCurrency: "BRL",
    marketValueBase: h.marketValueBase.toString(),
    carriedForward: h.carriedForward,
    status: h.status as SnapshotAssetRow["status"],
  }));
}

const base = (over: Partial<OverviewInput> = {}): OverviewInput => ({
  counts: { assets: read.assets.length, transactions: read.transactions.length, cashFlows: read.cashFlows.length },
  settings: read.settings,
  valuation: valuePortfolio(toPortfolioInput(read), fixture.asOf),
  unpricedAssets: 0,
  totals,
  latestRows: rowsAt("2026-02-27"),
  previousRows: rowsAt("2026-02-19"),
  assets: read.assets,
  names: read.names,
  ...over,
});

describe("overviewModel over the golden ledger", () => {
  it("headline equals the golden total at asOf; no card once every step is done", () => {
    const m = overviewModel(base());
    expect(m.headline).toMatchObject({ kind: "total", currency: "BRL" });
    if (m.headline.kind !== "total") throw new Error("no total");
    expect(
      new KernelDecimal(m.headline.total)
        .minus((expected.valuation as { total: string }).total)
        .abs()
        .lt("1e-8"),
    ).toBe(true);
    expect(m.firstRun).toBeNull();
  });

  it("day change is the difference of the last two totals and period change spans the window", () => {
    const m = overviewModel(base());
    const [a, b] = [valuations.at(-2)!, valuations.at(-1)!];
    expect(m.dayChange).toMatchObject({ from: a.date, to: b.date });
    expect(new KernelDecimal(m.dayChange!.delta).eq(new KernelDecimal(b.value).minus(a.value))).toBe(true);
    expect(m.periodChange).toMatchObject({ from: valuations[0].date, to: b.date });
    expect(m.sparkline).toHaveLength(valuations.length);
    expect(m.sparkline.every((p) => p.stale === false)).toBe(true);
  });

  it("allocation shares sum to exactly 1 over today's confident holdings, largest first", () => {
    const m = overviewModel(base());
    const sum = m.allocation.reduce((s, a) => s.plus(a.share), new KernelDecimal(0));
    expect(sum.eq(1)).toBe(true);
    for (let i = 1; i < m.allocation.length; i += 1) {
      expect(new KernelDecimal(m.allocation[i - 1].valueBase).gte(m.allocation[i].valueBase)).toBe(true);
    }
    expect(m.allocation.map((a) => a.kindId)).toContain("br.stock");
  });

  it("movers are the largest per-asset changes between the last two dates, with names", () => {
    const m = overviewModel(base());
    expect(m.movers.length).toBeGreaterThan(0);
    expect(m.movers.length).toBeLessThanOrEqual(5);
    for (let i = 1; i < m.movers.length; i += 1) {
      expect(new KernelDecimal(m.movers[i - 1].delta).abs().gte(new KernelDecimal(m.movers[i].delta).abs())).toBe(true);
    }
    expect(m.movers[0].name).toBe(read.names[m.movers[0].assetId]);
  });

  it("first-run card: a fresh instance has every step open; steps close from row counts; priced ignores accrual kinds", () => {
    const fresh = overviewModel(
      base({
        counts: { assets: 0, transactions: 0, cashFlows: 0 },
        valuation: null,
        totals: [],
        latestRows: [],
        previousRows: [],
        assets: [],
      }),
    );
    expect(fresh.firstRun?.steps.map((s) => s.done)).toEqual([false, false, false, false]);
    expect(fresh.headline).toEqual({ kind: "unpriced", unpriced: 0 });
    expect(fresh.dayChange).toBeNull();
    expect(fresh.allocation).toEqual([]);

    const touched = overviewModel(
      base({
        counts: { assets: 0, transactions: 0, cashFlows: 0 },
        valuation: null,
        settings: { ...read.settings, updated_at: "2026-02-01T00:00:00Z" },
        assets: [],
      }),
    );
    expect(touched.firstRun?.steps[0].done).toBe(true);

    const unpriced = overviewModel(
      base({ counts: { assets: 1, transactions: 0, cashFlows: 0 }, unpricedAssets: 1, valuation: null }),
    );
    expect(unpriced.firstRun?.steps.map((s) => [s.key, s.done])).toEqual([
      ["base_currency", false],
      ["first_asset", true],
      ["first_transaction", false],
      ["priced", false],
    ]);
    expect(unpriced.headline).toEqual({ kind: "unpriced", unpriced: 1 });

    const accrualOnly = overviewModel(
      base({
        counts: { assets: 1, transactions: 1, cashFlows: 0 },
        assets: read.assets.filter((a) => a.instrumentKind.id === "br.cdb"),
        valuation: null,
      }),
    );
    expect(accrualOnly.firstRun).toBeNull();
  });

  it("excludes a stale holding from the allocation and the movers, and counts it on the headline", () => {
    const v = valuePortfolio(toPortfolioInput(read), fixture.asOf);
    const stale = {
      ...v,
      excluded: [
        ...v.excluded,
        {
          assetId: "fii",
          status: "stale" as const,
          lastKnownBase: v.holdings[0].marketValueBase,
          priceDate: "2026-02-01",
          fxDate: null,
        },
      ],
    };
    const m = overviewModel(
      base({
        valuation: stale,
        latestRows: rowsAt("2026-02-27").map((r) => (r.assetId === "fii" ? { ...r, status: "stale" as const } : r)),
      }),
    );
    if (m.headline.kind !== "total") throw new Error("no total");
    expect(m.headline.staleCount).toBe(1);
    expect(m.movers.some((x) => x.assetId === "fii")).toBe(false);
  });
});
