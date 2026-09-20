import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { KernelDecimal, ONE } from "../decimal";
import { buildMarketData, type SeriesObservation } from "../types";
import { curveAt, discountFactor, rateAtTenor, type Curve } from "./yield-curve";

const pt = (date: string, tenorDays: number, value: string): SeriesObservation => ({ seriesId: "br.di", date, value, tenorDays });
const md = buildMarketData(
  [],
  [pt("2026-02-13", 365, "0.13"), pt("2026-02-13", 30, "0.12"), pt("2026-02-13", 730, "0.14"), pt("2026-02-12", 30, "0.11"), pt("2026-02-12", 365, "0.12")],
);

describe("curveAt", () => {
  it("returns the latest date's points sorted by tenor, with staleness", () => {
    const r = curveAt(md, "br.di", "2026-02-13", 5);
    expect(r.status).toBe("ok");
    if (r.status !== "ok") return;
    expect(r.observedOn).toBe("2026-02-13");
    expect(r.value.map((p) => [p.tenorDays, p.rate.toFixed()])).toEqual([[30, "0.12"], [365, "0.13"], [730, "0.14"]]);
    expect(Object.isFrozen(r.value)).toBe(true);
    expect(curveAt(md, "br.di", "2026-02-18", 5).status).toBe("carried_forward");
    expect(curveAt(md, "br.di", "2026-02-19", 5).status).toBe("stale");
    expect(curveAt(md, "br.di", "2026-02-11", 5)).toEqual({ status: "unpriced", reason: "no_observation" });
    // A date with only a tenor-0 point is not a curve.
    const scalarOnly = buildMarketData([], [pt("2026-02-13", 0, "0.1")]);
    expect(curveAt(scalarOnly, "br.di", "2026-02-13", 5)).toEqual({ status: "unpriced", reason: "no_observation" });
  });
});

const curve: Curve = [
  { tenorDays: 30, rate: new KernelDecimal("0.12") },
  { tenorDays: 365, rate: new KernelDecimal("0.13") },
  { tenorDays: 730, rate: new KernelDecimal("0.14") },
];

describe("rateAtTenor", () => {
  it("hits declared tenors exactly, interpolates linearly between, and is flat beyond the ends", () => {
    expect(rateAtTenor(curve, 30).toFixed()).toBe("0.12");
    expect(rateAtTenor(curve, 365).toFixed()).toBe("0.13");
    expect(rateAtTenor(curve, 730).toFixed()).toBe("0.14");
    expect(rateAtTenor(curve, 1).toFixed()).toBe("0.12");
    expect(rateAtTenor(curve, 3650).toFixed()).toBe("0.14");
    // Midpoint of 365 → 730 (547.5 is not an integer; use 548 and 547 around it).
    expect(rateAtTenor(curve, 548).toFixed(20)).toBe(new KernelDecimal("0.13").plus(new KernelDecimal("0.01").times(183).div(365)).toFixed(20));
    expect(() => rateAtTenor([], 30)).toThrow();
  });

  it("property: interpolated rates lie between the bracketing declared rates and are monotone on a monotone curve", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 1000 }), fc.integer({ min: 1, max: 1000 }), (t1, t2) => {
        const [lo, hi] = t1 <= t2 ? [t1, t2] : [t2, t1];
        const rLo = rateAtTenor(curve, lo);
        const rHi = rateAtTenor(curve, hi);
        expect(rHi.gte(rLo)).toBe(true);
        expect(rLo.gte("0.12") && rLo.lte("0.14")).toBe(true);
      }),
    );
  });
});

describe("discountFactor", () => {
  it("is 1 at tenor 0, 1/(1 + r) at one year, and decreasing in tenor", () => {
    expect(discountFactor(curve, 0).equals(ONE)).toBe(true);
    expect(discountFactor(curve, 365).minus(ONE.div("1.13")).abs().lt("1e-38")).toBe(true);
    expect(discountFactor(curve, 730).minus(ONE.div(new KernelDecimal("1.14").pow(2))).abs().lt("1e-38")).toBe(true);
    expect(() => discountFactor(curve, -1)).toThrow();
  });

  it("property: DF(t) = (1 + r(t))^(−t/365) and 0 < DF ≤ 1 for positive rates", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), (t) => {
        const df = discountFactor(curve, t);
        expect(df.gt(0) && df.lte(1)).toBe(true);
        const expected = ONE.plus(rateAtTenor(curve, t)).pow(new KernelDecimal(-t).div(365));
        expect(df.equals(expected)).toBe(true);
      }),
    );
  });
});
