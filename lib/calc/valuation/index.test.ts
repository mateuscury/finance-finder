import { describe, expect, it } from "vitest";
import { brCalendar } from "@/packs/br/calendar";
import { KernelDecimal } from "../decimal";
import { buildMarketData } from "../types";
import { valueHolding, type ValuationContext } from "./index";
import { asset, CDI, constantCdi, CURVE, kind, lot, pt, money } from "./testkit";

const ctx: ValuationContext = {
  market: buildMarketData(
    [
      { assetId: "fii", date: "2026-02-13", price: "10", currency: "BRL", sourceId: "br.brapi" },
      { assetId: "fund", date: "2026-02-13", price: "2", currency: "BRL", sourceId: "x" },
    ],
    [
      ...constantCdi(brCalendar, "2026-02-01", "2026-02-28", "0.0005"),
      pt("zz.curve", "2026-02-13", "0.05", 30),
      pt("zz.curve", "2026-02-13", "0.05", 3650),
    ],
  ),
  calendar: brCalendar,
  windowDays: 5,
  series: [CDI, CURVE],
};

describe("valueHolding", () => {
  it("dispatches on the instrument kind's strategy and sums lot quantities for quoted kinds", () => {
    const two = [lot("2026-02-02", "3", "9"), lot("2026-02-10", "7", "11")];
    const fii = valueHolding(asset("fii", kind("k", { kind: "market_price", sourceId: "s" })), two, "2026-02-13", ctx);
    if (fii.status !== "ok") throw new Error(fii.status);
    expect(money(fii.native)).toBe("BRL 100");

    const fund = valueHolding(
      asset("fund", kind("k", { kind: "nav_unit_price", sourceId: "s" })),
      two,
      "2026-02-13",
      ctx,
    );
    if (fund.status !== "ok") throw new Error(fund.status);
    expect(money(fund.native)).toBe("BRL 20");

    const cdb = valueHolding(
      asset(
        "cdb",
        kind("k", {
          kind: "accrual",
          convention: {
            dayCount: "BUS/252",
            compounding: "daily",
            index: { mode: "percent_of_index", seriesId: "br.cdi" },
          },
        }),
        { rate: "1" },
      ),
      [lot("2026-02-13", "1", "500")],
      "2026-02-13",
      ctx,
    );
    if (cdb.status !== "ok") throw new Error(cdb.status);
    expect(money(cdb.native)).toBe("BRL 500");

    const bond = valueHolding(
      asset("bond", kind("k", { kind: "curve_mark_to_market", seriesId: "zz.curve" }), {
        maturity: "2026-02-13",
        coupon: null,
        indexation: null,
      }),
      [lot("2026-02-02", "4", "0.9")],
      "2026-02-13",
      ctx,
    );
    if (bond.status !== "ok") throw new Error(bond.status);
    expect(money(bond.native)).toBe("BRL 4");
    expect(bond.unitValue).toEqual(new KernelDecimal(1));
  });

  it("refuses empty lots: callers skip assets with nothing open", () => {
    expect(() =>
      valueHolding(asset("fii", kind("k", { kind: "market_price", sourceId: "s" })), [], "2026-02-13", ctx),
    ).toThrow(/invalid_input/);
  });
});
