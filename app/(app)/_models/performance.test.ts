import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { KernelDecimal } from "@/lib/calc/decimal";
import type { CoveredTotal } from "./coverage";
import { loadGoldenFixture } from "@/lib/testing/golden";
import { benchmarkSelection, performanceModel } from "./performance";

const { fixture, expected } = loadGoldenFixture();
const dates = Object.entries(expected.valuations as Record<string, string>)
  .map(([date, value]) => ({ date, value }))
  .sort((a, b) => (a.date < b.date ? -1 : 1));
const totals: CoveredTotal[] = dates.map((d) => ({
  date: d.date,
  baseCurrency: "BRL",
  totalBase: d.value,
  rows: 7,
  staleRows: 0,
  carriedRows: 0,
  openHoldings: 7,
  complete: true,
}));
const flows = fixture.cashFlows.map((f) => ({ date: f.date, amount: f.amount }));
const period = { key: "all" as const, from: dates[0].date, to: dates.at(-1)!.date };
const br = PACKS.find((p) => p.id === "br")!;
const cdi = br.series.find((s) => s.id === "br.cdi")!;

describe("performanceModel over the golden ledger", () => {
  it("TWR and MWR equal expected.json's; the cumulative line ends at the TWR", () => {
    const m = performanceModel({ period, totals, flows, droppedFlows: 0, benchmarks: [], real: null });
    expect(m.empty).toBeNull();
    expect(
      new KernelDecimal(m.twr.rate!)
        .minus(expected.twr as string)
        .abs()
        .lt("1e-8"),
    ).toBe(true);
    expect(
      new KernelDecimal(m.mwr.rate!)
        .minus(expected.mwr as string)
        .abs()
        .lt("1e-8"),
    ).toBe(true);
    expect(m.points).toHaveLength(dates.length);
    expect(m.points[0].portfolio).toBe("0");
    expect(m.points.at(-1)!.portfolio).toBe(m.twr.rate);
    expect(m.partial).toBe(false);
    expect(m.excludedDates).toEqual([]);
    expect(m.chain).toEqual({ from: dates[0].date, to: dates.at(-1)!.date });
  });

  it("an incomplete date is not a valuation point (decision 53): excluded from the chain, listed", () => {
    const withStale = totals.map((t, i) => (i === 2 ? { ...t, complete: false } : t));
    const m = performanceModel({ period, totals: withStale, flows, droppedFlows: 0, benchmarks: [], real: null });
    expect(m.excludedDates).toEqual([dates[2].date]);
    expect(m.points.map((p) => p.date)).not.toContain(dates[2].date);
    expect(m.points).toHaveLength(dates.length - 1);
    // Fewer points is a coarser chain: still a TWR, defined, and the line still ends at it.
    expect(m.twr.rate).not.toBeNull();
    expect(m.points.at(-1)!.portfolio).toBe(m.twr.rate);
  });

  it("benchmarks and the real line are carried per point, stale ones marked, unpriced ones null", () => {
    const points = dates.map((d, i) => ({
      date: d.date,
      value:
        i === 0
          ? ({ status: "ok", value: new KernelDecimal(0), observedOn: d.date } as const)
          : i === dates.length - 1
            ? ({ status: "stale", lastKnown: new KernelDecimal("0.01"), observedOn: d.date } as const)
            : ({ status: "unpriced", reason: "series_gap" } as const),
    }));
    const m = performanceModel({
      period,
      totals,
      flows,
      droppedFlows: 0,
      benchmarks: [{ descriptor: cdi, points }],
      real: points,
    });
    expect(m.points[0].benchmarks["br.cdi"]).toBe("0");
    expect(m.points[1].benchmarks["br.cdi"]).toBeNull();
    expect(m.points.at(-1)!.benchmarks["br.cdi"]).toBe("0.01");
    expect(m.points.at(-1)!.staleMarks).toEqual(["br.cdi", "real"]);
  });

  it("below two confident points the screen is empty; dropped flows or skipped sub-periods mark it partial", () => {
    expect(
      performanceModel({ period, totals: totals.slice(0, 1), flows, droppedFlows: 0, benchmarks: [], real: null })
        .empty,
    ).toBe("history");
    expect(performanceModel({ period, totals, flows, droppedFlows: 1, benchmarks: [], real: null }).partial).toBe(true);
    // No external flows is a buy-and-hold: the MWR is the growth from start to end, defined.
    const noFlows = performanceModel({ period, totals, flows: [], droppedFlows: 0, benchmarks: [], real: null });
    expect(noFlows.mwr.rate).not.toBeNull();
    // A zero start with nothing deposited has no outflow to discount from (decision 2).
    const zeroStart = totals.map((x, i) => (i === 0 ? { ...x, totalBase: "0" } : x));
    expect(
      performanceModel({ period, totals: zeroStart, flows: [], droppedFlows: 0, benchmarks: [], real: null }).mwr,
    ).toEqual({ rate: null, reason: "insufficient_flows" });
  });

  it("benchmarkSelection: the requested ids that exist, else the first benchmark-role series, or none on request", () => {
    expect(benchmarkSelection(br.series, "br.ibovespa,br.cdi").map((s) => s.id)).toEqual(["br.cdi", "br.ibovespa"]);
    expect(benchmarkSelection(br.series, undefined).map((s) => s.id)).toEqual(["br.cdi"]);
    expect(benchmarkSelection(br.series, "nope").map((s) => s.id)).toEqual(["br.cdi"]);
    expect(benchmarkSelection(br.series, "none")).toEqual([]);
  });
});
