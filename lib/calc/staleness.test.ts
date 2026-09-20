import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays } from "./dates";
import { classify, hasValue, observed, unpriced } from "./staleness";

describe("classify", () => {
  it("is fresh on the day, carried forward through the window, stale one day past it", () => {
    expect(classify("2026-02-13", "2026-02-13", 5)).toBe("fresh");
    expect(classify("2026-02-13", "2026-02-18", 5)).toBe("carried_forward"); // age 5 = window
    expect(classify("2026-02-13", "2026-02-19", 5)).toBe("stale"); // age 6
    expect(classify("2026-02-13", "2026-02-14", 0)).toBe("stale"); // window 0: only same-day is usable
  });

  it("property: the boundary is exact for every window", () => {
    const day = fc.integer({ min: 0, max: 700 }).map((n) => addDays("2025-01-01", n));
    fc.assert(
      fc.property(day, fc.integer({ min: 0, max: 90 }), fc.integer({ min: 0, max: 120 }), (d, window, age) => {
        const asOf = addDays(d, age);
        const expected = age === 0 ? "fresh" : age <= window ? "carried_forward" : "stale";
        expect(classify(d, asOf, window)).toBe(expected);
      }),
    );
  });
});

describe("observed / hasValue", () => {
  it("maps freshness to the result shape", () => {
    expect(observed(1, "2026-02-13", "2026-02-13", 5)).toEqual({ status: "ok", value: 1, observedOn: "2026-02-13" });
    expect(observed(1, "2026-02-13", "2026-02-18", 5)).toEqual({ status: "carried_forward", value: 1, observedOn: "2026-02-13" });
    expect(observed(1, "2026-02-13", "2026-02-19", 5)).toEqual({ status: "stale", lastKnown: 1, observedOn: "2026-02-13" });
    expect(hasValue(observed(1, "2026-02-13", "2026-02-18", 5))).toBe(true);
    expect(hasValue(observed(1, "2026-02-13", "2026-02-19", 5))).toBe(false);
    expect(hasValue(unpriced("no_fx_series"))).toBe(false);
    expect(unpriced("series_gap")).toEqual({ status: "unpriced", reason: "series_gap" });
  });
});
