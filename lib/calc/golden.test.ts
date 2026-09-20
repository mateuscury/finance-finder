import { describe, expect, it } from "vitest";
import { compareGolden, GoldenFixtureSchema } from "./golden";

describe("compareGolden", () => {
  it("compares decimal strings within the tolerance and everything else by equality", () => {
    expect(compareGolden({ a: "1.000000001" }, { a: "1" })).toEqual([]);
    expect(compareGolden({ a: "1.000000011" }, { a: "1" })).toEqual([{ path: "a", expected: "1", actual: "1.000000011" }]);
    expect(compareGolden({ s: "ok", n: null, arr: ["x"] }, { s: "ok", n: null, arr: ["x"] })).toEqual([]);
    expect(compareGolden({ s: "carried_forward" }, { s: "ok" })).toEqual([{ path: "s", expected: "ok", actual: "carried_forward" }]);
    expect(compareGolden({ n: "0.1" }, { n: null })).toEqual([{ path: "n", expected: null, actual: "0.1" }]);
  });

  it("flags missing and extra keys, mismatched array lengths, and skips $-annotations", () => {
    expect(compareGolden({ a: "1", b: "2" }, { a: "1", $derivation: { anything: 1 }, $comment: "x" })).toEqual([{ path: "b", expected: undefined, actual: "2" }]);
    expect(compareGolden({ a: "1" }, { a: "1", b: "2" })).toEqual([{ path: "b", expected: "2", actual: undefined }]);
    expect(compareGolden({ arr: ["1"] }, { arr: ["1", "2"] })).toEqual([{ path: "arr", expected: ["1", "2"], actual: ["1"] }]);
    expect(compareGolden({ o: { x: "1" } }, { o: "1" })).toEqual([{ path: "o", expected: "1", actual: { x: "1" } }]);
    expect(compareGolden({ o: "1" }, { o: { x: "1" } })).toEqual([{ path: "o", expected: { x: "1" }, actual: "1" }]);
  });

  it("reports nested paths", () => {
    expect(compareGolden({ valuation: { assets: { fii: { base: "1" } } } }, { valuation: { assets: { fii: { base: "2" } } } })).toEqual([
      { path: "valuation.assets.fii.base", expected: "2", actual: "1" },
    ]);
  });
});

describe("GoldenFixtureSchema", () => {
  const minimal = {
    baseCurrency: "BRL",
    asOf: "2026-02-27",
    valuationDates: ["2026-02-10", "2026-02-27"],
    assets: [],
    transactions: [],
    cashFlows: [],
    prices: {},
    series: {},
  };

  it("requires asOf to be a valuation date and defaults fees, fxRate, sourceId and tenorDays", () => {
    expect(GoldenFixtureSchema.safeParse(minimal).success).toBe(true);
    expect(GoldenFixtureSchema.safeParse({ ...minimal, asOf: "2026-02-28" }).success).toBe(false);
    const parsed = GoldenFixtureSchema.parse({
      ...minimal,
      transactions: [{ id: "t", assetId: "a", tradeDate: "2026-02-10", type: "buy", quantity: "1", unitPrice: "1", currency: "BRL" }],
      prices: { X: [{ date: "2026-02-10", price: "1", currency: "BRL" }] },
      series: { "br.cdi": [{ date: "2026-02-10", value: "0.0005" }] },
    });
    expect(parsed.transactions[0]).toMatchObject({ fees: "0", fxRate: null });
    expect(parsed.prices.X[0].sourceId).toBe("manual");
    expect(parsed.series["br.cdi"][0].tenorDays).toBe(0);
  });

  it("rejects floats, bad dates and unprefixed series ids", () => {
    expect(GoldenFixtureSchema.safeParse({ ...minimal, cashFlows: [{ id: "c", date: "2026-02-10", amount: 1, currency: "BRL" }] }).success).toBe(false);
    expect(GoldenFixtureSchema.safeParse({ ...minimal, valuationDates: ["2026-02-30", "2026-02-27"] }).success).toBe(false);
    expect(GoldenFixtureSchema.safeParse({ ...minimal, series: { cdi: [] } }).success).toBe(false);
  });
});
