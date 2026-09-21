import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { compareGolden, GoldenFixtureSchema, runGolden } from "./golden";
import { isKernelError } from "./errors";

describe("compareGolden", () => {
  it("compares decimal strings within the tolerance and everything else by equality", () => {
    expect(compareGolden({ a: "1.000000001" }, { a: "1" })).toEqual([]);
    expect(compareGolden({ a: "1.000000011" }, { a: "1" })).toEqual([
      { path: "a", expected: "1", actual: "1.000000011" },
    ]);
    expect(compareGolden({ s: "ok", n: null, arr: ["x"] }, { s: "ok", n: null, arr: ["x"] })).toEqual([]);
    expect(compareGolden({ s: "carried_forward" }, { s: "ok" })).toEqual([
      { path: "s", expected: "ok", actual: "carried_forward" },
    ]);
    expect(compareGolden({ n: "0.1" }, { n: null })).toEqual([{ path: "n", expected: null, actual: "0.1" }]);
  });

  it("flags missing and extra keys, mismatched array lengths, and skips $-annotations", () => {
    expect(compareGolden({ a: "1", b: "2" }, { a: "1", $derivation: { anything: 1 }, $comment: "x" })).toEqual([
      { path: "b", expected: undefined, actual: "2" },
    ]);
    expect(compareGolden({ a: "1" }, { a: "1", b: "2" })).toEqual([{ path: "b", expected: "2", actual: undefined }]);
    expect(compareGolden({ arr: ["1"] }, { arr: ["1", "2"] })).toEqual([
      { path: "arr", expected: ["1", "2"], actual: ["1"] },
    ]);
    expect(compareGolden({ o: { x: "1" } }, { o: "1" })).toEqual([{ path: "o", expected: "1", actual: { x: "1" } }]);
    expect(compareGolden({ o: "1" }, { o: { x: "1" } })).toEqual([{ path: "o", expected: { x: "1" }, actual: "1" }]);
  });

  it("reports nested paths", () => {
    expect(
      compareGolden(
        { valuation: { assets: { fii: { base: "1" } } } },
        { valuation: { assets: { fii: { base: "2" } } } },
      ),
    ).toEqual([{ path: "valuation.assets.fii.base", expected: "2", actual: "1" }]);
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
      transactions: [
        { id: "t", assetId: "a", tradeDate: "2026-02-10", type: "buy", quantity: "1", unitPrice: "1", currency: "BRL" },
      ],
      prices: { X: [{ date: "2026-02-10", price: "1", currency: "BRL" }] },
      series: { "br.cdi": [{ date: "2026-02-10", value: "0.0005" }] },
    });
    expect(parsed.transactions[0]).toMatchObject({ fees: "0", fxRate: null });
    expect(parsed.prices.X[0].sourceId).toBe("manual");
    expect(parsed.series["br.cdi"][0].tenorDays).toBe(0);
  });

  it("rejects floats, bad dates and unprefixed series ids", () => {
    expect(
      GoldenFixtureSchema.safeParse({
        ...minimal,
        cashFlows: [{ id: "c", date: "2026-02-10", amount: 1, currency: "BRL" }],
      }).success,
    ).toBe(false);
    expect(GoldenFixtureSchema.safeParse({ ...minimal, valuationDates: ["2026-02-30", "2026-02-27"] }).success).toBe(
      false,
    );
    expect(GoldenFixtureSchema.safeParse({ ...minimal, series: { cdi: [] } }).success).toBe(false);
  });
});

describe("runGolden refuses a fixture that does not fit the packs it is given", () => {
  const base = {
    baseCurrency: "BRL",
    asOf: "2026-02-13",
    valuationDates: ["2026-02-13"],
    assets: [
      { id: "x", instrumentKind: "br.fii", identifier: "HGLG11", nativeCurrency: "BRL", metadata: { fundName: "x" } },
    ],
    transactions: [
      {
        id: "t1",
        assetId: "x",
        tradeDate: "2026-02-02",
        type: "buy",
        quantity: "1",
        unitPrice: "100",
        currency: "BRL",
        fees: "0",
      },
    ],
    cashFlows: [{ id: "c1", date: "2026-02-02", amount: "100", currency: "BRL" }],
    prices: { HGLG11: [{ date: "2026-02-13", price: "101", currency: "BRL" }] },
    series: {},
  };
  const parse = (over: Record<string, unknown>) => GoldenFixtureSchema.parse({ ...base, ...over });
  const codeOf = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      if (isKernelError(e)) return e.code;
      throw e;
    }
    return "no throw";
  };

  it("names an unknown pack, an unknown kind, orphan prices and a non-base cash flow as contract violations", () => {
    expect(codeOf(() => runGolden(parse({ assets: [{ ...base.assets[0], instrumentKind: "zz.fii" }] }), PACKS))).toBe(
      "invalid_input",
    );
    expect(codeOf(() => runGolden(parse({ assets: [{ ...base.assets[0], instrumentKind: "br.nope" }] }), PACKS))).toBe(
      "invalid_input",
    );
    expect(codeOf(() => runGolden(parse({ prices: { ...base.prices, ZZZZ11: base.prices.HGLG11 } }), PACKS))).toBe(
      "invalid_input",
    );
    expect(codeOf(() => runGolden(parse({ cashFlows: [{ ...base.cashFlows[0], currency: "USD" }] }), PACKS))).toBe(
      "currency_mismatch",
    );
  });

  it("runs a one-asset, one-date fixture: MWR is null over a zero-length window, contribution present", () => {
    const out = runGolden(parse({}), PACKS);
    expect(out.valuation.total).toBe("101");
    expect(out.mwr).toBeNull();
    expect(out.contribution.assets).toHaveProperty("x");
  });
});
