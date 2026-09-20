import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { KernelDecimal } from "../decimal";
import { addDays, daysBetween } from "../dates";
import { hasValue } from "../staleness";
import { buildMarketData, type SeriesObservation } from "../types";
import { INFLATION_CARRY_DAYS, inflationLevelAt } from "./inflation";

const pt = (date: string, value: string): SeriesObservation => ({ seriesId: "br.ipca", date, value, tenorDays: 0 });
// Month-end anchors, as packs/br publishes them (README quirk).
const md = buildMarketData([], [pt("2026-01-31", "7000"), pt("2026-02-28", "7035"), pt("2026-03-31", "7070")]);

describe("inflationLevelAt", () => {
  it("returns the anchor exactly on an anchor date in both modes", () => {
    for (const mode of ["none", "linear_daily"] as const) {
      expect(inflationLevelAt(md, "br.ipca", "2026-02-28", mode)).toEqual({ status: "ok", value: new KernelDecimal("7035"), observedOn: "2026-02-28" });
    }
  });

  it("is unpriced before the first anchor and for an unknown series", () => {
    expect(inflationLevelAt(md, "br.ipca", "2026-01-30", "none")).toEqual({ status: "unpriced", reason: "before_first_anchor" });
    expect(inflationLevelAt(md, "br.nope", "2026-02-15", "none")).toEqual({ status: "unpriced", reason: "no_observation" });
  });

  it("`none` steps: the last anchor ≤ date, status ok", () => {
    expect(inflationLevelAt(md, "br.ipca", "2026-02-15", "none")).toEqual({ status: "ok", value: new KernelDecimal("7000"), observedOn: "2026-01-31" });
    expect(inflationLevelAt(md, "br.ipca", "2026-03-30", "none")).toEqual({ status: "ok", value: new KernelDecimal("7035"), observedOn: "2026-02-28" });
  });

  it("`linear_daily` interpolates on calendar days between the bracketing anchors", () => {
    // 31 Jan → 28 Feb is 28 days; 14 Feb is day 14: 7000 + 35 × 14/28 = 7017.5
    expect(inflationLevelAt(md, "br.ipca", "2026-02-14", "linear_daily")).toEqual({ status: "ok", value: new KernelDecimal("7017.5"), observedOn: "2026-02-14" });
    // 28 Feb → 31 Mar is 31 days; 1 Mar is day 1: 7035 + 35/31
    const r = inflationLevelAt(md, "br.ipca", "2026-03-01", "linear_daily");
    expect(r.status).toBe("ok");
    if (r.status === "ok") expect(r.value.equals(new KernelDecimal("7035").plus(new KernelDecimal(35).div(31)))).toBe(true);
  });

  it("after the last anchor: flat and carried forward for 62 days, stale on day 63", () => {
    expect(INFLATION_CARRY_DAYS).toBe(62);
    const day62 = addDays("2026-03-31", 62);
    const day63 = addDays("2026-03-31", 63);
    for (const mode of ["none", "linear_daily"] as const) {
      expect(inflationLevelAt(md, "br.ipca", day62, mode)).toEqual({ status: "carried_forward", value: new KernelDecimal("7070"), observedOn: "2026-03-31" });
      expect(inflationLevelAt(md, "br.ipca", day63, mode)).toEqual({ status: "stale", lastKnown: new KernelDecimal("7070"), observedOn: "2026-03-31" });
    }
  });

  it("property: linear interpolation equals the anchors at anchor dates and is monotone between them", () => {
    // Increasing anchors at random month-ish spacing.
    const anchors = fc
      .array(fc.tuple(fc.integer({ min: 20, max: 40 }), fc.integer({ min: 0, max: 500 })), { minLength: 2, maxLength: 8 })
      .map((steps) => {
        let date = "2025-01-31";
        let level = 5000;
        return steps.map(([gap, rise]) => {
          date = addDays(date, gap);
          level += rise;
          return pt(date, String(level));
        });
      });
    fc.assert(
      fc.property(anchors, fc.integer({ min: 0, max: 400 }), (points, offset) => {
        const data = buildMarketData([], points);
        for (const p of points) {
          const at = inflationLevelAt(data, "br.ipca", p.date, "linear_daily");
          expect(at).toEqual({ status: "ok", value: new KernelDecimal(p.value), observedOn: p.date });
        }
        const first = points[0].date;
        const last = points[points.length - 1].date;
        const d = addDays(first, offset % (daysBetween(first, last) + 1));
        const next = addDays(d, 1);
        const a = inflationLevelAt(data, "br.ipca", d, "linear_daily");
        const b = inflationLevelAt(data, "br.ipca", next, "linear_daily");
        if (hasValue(a) && hasValue(b)) expect(b.value.gte(a.value)).toBe(true);
      }),
    );
  });
});
