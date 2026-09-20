import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { KernelDecimal, ONE } from "../decimal";
import { buildMarketData, type SeriesObservation } from "../types";
import { bondCashFlows, valueCurveMtm } from "./curve-mtm";
import type { ValuationContext } from "./result";
import { asset, CURVE, kind, near, pt, sevenDay } from "./testkit";

const BOND = kind("zz.bond", { kind: "curve_mark_to_market", seriesId: "zz.curve" });
const ONE_UNIT = new KernelDecimal("1");

function flat(date: string, rate: string): SeriesObservation[] {
  return [pt("zz.curve", date, rate, 30), pt("zz.curve", date, rate, 3650)];
}
function ctx(points: SeriesObservation[]): ValuationContext {
  return { market: buildMarketData([], points), calendar: sevenDay, windowDays: 1, series: [CURVE] };
}
const meta = (maturity: string, coupon: { rate: string; frequency: 1 | 2 | 4 | 12 } | null, indexation: { seriesId: string } | null = null) => ({
  maturity,
  coupon,
  indexation,
});

describe("bondCashFlows", () => {
  it("counts coupons back from maturity, keeps flows dated on or after asOf, principal last", () => {
    const flows = bondCashFlows("2027-02-13", { rate: "0.06", frequency: 2 }, "2026-02-14");
    expect(flows.map((f) => [f.date, f.amount.toFixed()])).toEqual([
      ["2026-08-13", "0.03"],
      ["2027-02-13", "0.03"],
      ["2027-02-13", "1"],
    ]);
    // A coupon dated asOf is still in the value (DF(0) = 1); one the day before is not.
    expect(bondCashFlows("2027-02-13", { rate: "0.06", frequency: 2 }, "2026-02-13").map((f) => f.date)).toEqual(["2026-02-13", "2026-08-13", "2027-02-13", "2027-02-13"]);
    expect(bondCashFlows("2027-02-13", null, "2026-02-14").map((f) => f.date)).toEqual(["2027-02-13"]);
  });

  it("computes every coupon date from maturity, so end-of-month clamping never drifts", () => {
    expect(bondCashFlows("2027-05-31", { rate: "0.04", frequency: 2 }, "2026-01-01").map((f) => f.date)).toEqual([
      "2026-05-31",
      "2026-11-30",
      "2027-05-31",
      "2027-05-31",
    ]);
  });
});

describe("valueCurveMtm", () => {
  it("two-coupon bond off a flat 5% curve matches the closed form", () => {
    // asOf 14 Feb 2026 → coupons at 180 days (13 Aug) and 364 days (13 Feb 2027).
    const a = asset("b1", BOND, meta("2027-02-13", { rate: "0.06", frequency: 2 }));
    const r = valueCurveMtm(a, new KernelDecimal("1000"), "2026-02-14", ctx(flat("2026-02-14", "0.05")));
    if (r.status !== "ok") throw new Error(r.status);
    const g = new KernelDecimal("1.05");
    const unit = new KernelDecimal("0.03").times(g.pow(new KernelDecimal(-180).div(365))).plus(new KernelDecimal("1.03").times(g.pow(new KernelDecimal(-364).div(365))));
    expect(near(r.unitValue, unit)).toBe(true);
    expect(near(r.native.amount, unit.times(1000))).toBe(true);
    expect(r.priceDate).toBe("2026-02-14");
  });

  it("a zero-coupon bond is one discount factor", () => {
    const a = asset("b1", BOND, meta("2027-02-14", null));
    const r = valueCurveMtm(a, ONE_UNIT, "2026-02-14", ctx(flat("2026-02-14", "0.05")));
    if (r.status !== "ok") throw new Error(r.status);
    expect(near(r.unitValue, ONE.div("1.05"))).toBe(true);
  });

  it("on the maturity day the bond is worth par plus its final coupon; past it, matured", () => {
    const a = asset("b1", BOND, meta("2026-02-14", { rate: "0.06", frequency: 2 }));
    const r = valueCurveMtm(a, ONE_UNIT, "2026-02-14", ctx(flat("2026-02-14", "0.05")));
    if (r.status !== "ok") throw new Error(r.status);
    expect(r.unitValue.toFixed()).toBe("1.03");
    expect(valueCurveMtm(a, ONE_UNIT, "2026-02-15", ctx(flat("2026-02-15", "0.05")))).toEqual({ status: "unpriced", reason: "matured" });
  });

  it("indexation, bad metadata and a missing curve are unpriced with fixed reasons", () => {
    const c = ctx(flat("2026-02-14", "0.05"));
    expect(valueCurveMtm(asset("b1", BOND, meta("2030-01-01", null, { seriesId: "br.ipca" })), ONE_UNIT, "2026-02-14", c)).toEqual({
      status: "unpriced",
      reason: "indexation_not_supported",
    });
    expect(valueCurveMtm(asset("b1", BOND, { maturity: "2030-01-01" }), ONE_UNIT, "2026-02-14", c)).toEqual({ status: "unpriced", reason: "invalid_metadata" });
    expect(valueCurveMtm(asset("b1", BOND, meta("2030-01-01", null)), ONE_UNIT, "2026-02-13", c)).toEqual({ status: "unpriced", reason: "no_observation" });
  });

  it("follows the curve observation's staleness", () => {
    const a = asset("b1", BOND, meta("2030-01-01", null));
    const c = ctx(flat("2026-02-14", "0.05"));
    expect(valueCurveMtm(a, ONE_UNIT, "2026-02-15", c)).toMatchObject({ status: "carried_forward", priceDate: "2026-02-14" });
    const stale = valueCurveMtm(a, ONE_UNIT, "2026-02-16", c);
    expect(stale.status).toBe("stale");
    if (stale.status === "stale") expect(stale.lastKnown.currency).toBe("BRL");
  });

  const rate = fc.integer({ min: 1, max: 2000 }).map((bp) => new KernelDecimal(bp).div(10000).toFixed());

  it("property: a bond whose annual coupon equals a flat yield is worth par plus today's coupon on a coupon date", () => {
    // 13 Feb 2026 → 2027 → 2028 are 365-day years, so ACT/365 discounting is exact.
    fc.assert(
      fc.property(rate, (r) => {
        const a = asset("b1", BOND, meta("2028-02-13", { rate: r, frequency: 1 }));
        const v = valueCurveMtm(a, ONE_UNIT, "2026-02-13", ctx(flat("2026-02-13", r)));
        if (v.status !== "ok") throw new Error(v.status);
        expect(near(v.unitValue, ONE.plus(r))).toBe(true);
      }),
    );
  });

  it("property: a zero-coupon bond off a flat curve is (1 + r)^(−days/365)", () => {
    fc.assert(
      fc.property(rate, fc.integer({ min: 0, max: 3650 }), (r, days) => {
        const maturity = new Date(Date.UTC(2026, 1, 13) + days * 86_400_000).toISOString().slice(0, 10);
        const a = asset("b1", BOND, meta(maturity, null));
        const v = valueCurveMtm(a, ONE_UNIT, "2026-02-13", ctx(flat("2026-02-13", r)));
        if (v.status !== "ok") throw new Error(v.status);
        expect(near(v.unitValue, ONE.plus(r).pow(new KernelDecimal(-days).div(365)))).toBe(true);
      }),
    );
  });
});
