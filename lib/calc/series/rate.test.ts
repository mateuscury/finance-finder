import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { brCalendar } from "@/packs/br/calendar";
import type { MarketCalendar } from "@/packs/types";
import { businessDaysBetween, isBusinessDay } from "../calendar";
import { KernelDecimal, ONE } from "../decimal";
import { addDays, daysBetween } from "../dates";
import { isKernelError } from "../errors";
import { buildMarketData, type SeriesObservation } from "../types";
import { compoundRate } from "./rate";

const sevenDay: MarketCalendar = { timezone: "UTC", weekend: [], holidays: () => [], settlement: "T+0" };

/** A point on every day (or business day) of [start, end] with one value. */
function constantSeries(seriesId: string, start: string, end: string, value: string, businessOnly: boolean): SeriesObservation[] {
  const out: SeriesObservation[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (businessOnly && !isBusinessDay(brCalendar, d)) continue;
    out.push({ seriesId, date: d, value, tenorDays: 0 });
  }
  return out;
}

const START = "2026-01-02";
const END = "2026-04-30";
const daily = { kind: "rate_daily", dayCount: "BUS/252" } as const;
const cdi = buildMarketData([], constantSeries("br.cdi", START, END, "0.0005", true));
const dayIn = fc.integer({ min: 0, max: daysBetween(START, END) }).map((n) => addDays(START, n));

describe("rate_daily", () => {
  it("compounds each business day in (from, to] and skips closures without a gap", () => {
    // Fri 13 Feb → Wed 18 Feb spans Carnival: only the 18th is covered.
    const r = compoundRate(cdi, "br.cdi", daily, brCalendar, "2026-02-13", "2026-02-18");
    expect(r).toEqual({ status: "ok", factor: new KernelDecimal("1.0005"), days: 1 });
    expect(compoundRate(cdi, "br.cdi", daily, brCalendar, "2026-02-13", "2026-02-13")).toEqual({ status: "ok", factor: ONE, days: 0 });
  });

  it("property: a constant daily rate over n business days equals (1 + r)^n", () => {
    fc.assert(
      fc.property(dayIn, dayIn, (a, b) => {
        const [from, to] = a <= b ? [a, b] : [b, a];
        const n = businessDaysBetween(brCalendar, from, to);
        const r = compoundRate(cdi, "br.cdi", daily, brCalendar, from, to);
        expect(r.status).toBe("ok");
        if (r.status !== "ok") return;
        expect(r.days).toBe(n);
        const expected = new KernelDecimal("1.0005").pow(n);
        expect(r.factor.minus(expected).abs().lt("1e-30")).toBe(true);
      }),
    );
  });

  it("reports a gap with the missing date and never carries a rate forward", () => {
    const points = constantSeries("br.cdi", START, END, "0.0005", true).filter((p) => p.date !== "2026-03-10");
    const gappy = buildMarketData([], points);
    expect(compoundRate(gappy, "br.cdi", daily, brCalendar, "2026-03-06", "2026-03-12")).toEqual({
      status: "unpriced",
      reason: "series_gap",
      missingDate: "2026-03-10",
    });
    // An interval that does not touch the gap is unaffected.
    expect(compoundRate(gappy, "br.cdi", daily, brCalendar, "2026-03-02", "2026-03-09").status).toBe("ok");
    // Unknown series: the first covered day is the gap.
    expect(compoundRate(gappy, "br.nope", daily, brCalendar, "2026-03-02", "2026-03-03")).toMatchObject({ status: "unpriced", reason: "series_gap" });
  });

  it("property: percent_of_index with multiplier 1 equals the index; 1.1 compounds 1 + 1.1·r", () => {
    fc.assert(
      fc.property(dayIn, dayIn, (a, b) => {
        const [from, to] = a <= b ? [a, b] : [b, a];
        const plain = compoundRate(cdi, "br.cdi", daily, brCalendar, from, to);
        const unit = compoundRate(cdi, "br.cdi", daily, brCalendar, from, to, ONE);
        const boosted = compoundRate(cdi, "br.cdi", daily, brCalendar, from, to, new KernelDecimal("1.1"));
        if (plain.status !== "ok" || unit.status !== "ok" || boosted.status !== "ok") throw new Error("expected ok");
        expect(unit.factor.equals(plain.factor)).toBe(true);
        expect(boosted.factor.minus(new KernelDecimal("1.00055").pow(plain.days)).abs().lt("1e-30")).toBe(true);
      }),
    );
  });

  it("uses calendar days for ACT/* and throws unsupported_convention for 30/360", () => {
    const act = buildMarketData([], constantSeries("uk.sonia", START, END, "0.0001", false));
    const r = compoundRate(act, "uk.sonia", { kind: "rate_daily", dayCount: "ACT/365" }, sevenDay, "2026-02-13", "2026-02-18");
    expect(r).toEqual({ status: "ok", factor: new KernelDecimal("1.0001").pow(5), days: 5 });
    try {
      compoundRate(act, "uk.sonia", { kind: "rate_daily", dayCount: "30/360" }, sevenDay, "2026-02-13", "2026-02-18");
      expect.unreachable();
    } catch (err) {
      expect(isKernelError(err, "unsupported_convention")).toBe(true);
    }
    expect(() => compoundRate(act, "uk.sonia", daily, sevenDay, "2026-02-18", "2026-02-13")).toThrow();
  });
});

describe("rate_annual", () => {
  it("compounds (1 + r)^(1/N) per covered day, N = 252 for BUS/252 and 365 for ACT/365", () => {
    const selic = buildMarketData([], constantSeries("br.selic", START, END, "0.1325", true));
    const r = compoundRate(selic, "br.selic", { kind: "rate_annual", dayCount: "BUS/252" }, brCalendar, "2025-12-31", "2026-12-31");
    // 249 business days in 2026 but the series ends in April: a gap after it.
    expect(r).toMatchObject({ status: "unpriced", reason: "series_gap" });
    const r2 = compoundRate(selic, "br.selic", { kind: "rate_annual", dayCount: "BUS/252" }, brCalendar, "2026-01-01", "2026-01-31");
    const n = businessDaysBetween(brCalendar, "2026-01-01", "2026-01-31");
    expect(r2.status).toBe("ok");
    if (r2.status !== "ok") return;
    expect(r2.days).toBe(n);
    const expected = new KernelDecimal("1.1325").pow(new KernelDecimal(n).div(252));
    expect(r2.factor.minus(expected).abs().lt("1e-30")).toBe(true);

    const act = buildMarketData([], constantSeries("uk.base", START, END, "0.05", false));
    const r3 = compoundRate(act, "uk.base", { kind: "rate_annual", dayCount: "ACT/365" }, sevenDay, "2026-01-01", "2026-12-31");
    expect(r3).toMatchObject({ status: "unpriced", reason: "series_gap", missingDate: "2026-05-01" });
    const r4 = compoundRate(act, "uk.base", { kind: "rate_annual", dayCount: "ACT/365" }, sevenDay, "2026-01-02", "2026-01-12");
    expect(r4.status).toBe("ok");
    if (r4.status !== "ok") return;
    expect(r4.factor.minus(new KernelDecimal("1.05").pow(new KernelDecimal(10).div(365))).abs().lt("1e-30")).toBe(true);
  });

  it("throws unsupported_convention for ACT/360 and 30/360", () => {
    const act = buildMarketData([], constantSeries("uk.base", START, END, "0.05", false));
    for (const dayCount of ["ACT/360", "30/360"] as const) {
      try {
        compoundRate(act, "uk.base", { kind: "rate_annual", dayCount }, sevenDay, "2026-01-02", "2026-01-12");
        expect.unreachable();
      } catch (err) {
        expect(isKernelError(err, "unsupported_convention")).toBe(true);
      }
    }
  });
});
