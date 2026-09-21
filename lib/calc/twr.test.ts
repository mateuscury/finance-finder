import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { KernelDecimal, ONE } from "./decimal";
import { addDays } from "./dates";
import { twr, type BaseFlow, type ValuationPoint } from "./twr";

const v = (date: string, value: string): ValuationPoint => ({ date, value });
const f = (date: string, amount: string): BaseFlow => ({ date, amount });
const D0 = "2026-02-10";
const day = (n: number) => addDays(D0, n);

describe("twr", () => {
  it("with no flows is V_end / V_start − 1", () => {
    const r = twr([v(day(0), "100"), v(day(1), "110"), v(day(2), "121")], []);
    expect(r.twr?.toFixed()).toBe("0.21");
    expect(r.from).toBe(day(0));
    expect(r.to).toBe(day(2));
    expect(r.subPeriods.map((p) => p.return.toFixed())).toEqual(["0.1", "0.1"]);
    expect(r.skipped).toEqual([]);
    expect(r.ignored).toEqual([]);
  });

  it("start-of-day: a flow dated D is in the denominator of D's sub-period", () => {
    const r = twr([v(day(0), "100"), v(day(1), "220")], [f(day(1), "100")]);
    expect(r.twr?.toFixed()).toBe("0.1");
    expect(r.subPeriods[0].flow.toFixed()).toBe("100");
  });

  it("a flow on a non-valuation date attaches to the next valuation date", () => {
    const r = twr([v(day(0), "100"), v(day(3), "220")], [f(day(1), "100")]);
    expect(r.twr?.toFixed()).toBe("0.1");
  });

  it("flows on or before the first valuation are part of V₀; flows after the last are reported", () => {
    const r = twr([v(day(0), "100"), v(day(1), "110")], [f(day(0), "100"), f(addDays(D0, -5), "50"), f(day(2), "999")]);
    expect(r.twr?.toFixed()).toBe("0.1");
    expect(r.ignored).toEqual([f(day(2), "999")]);
  });

  it("skips and reports a non-positive start, so an unfunded ledger still has a return", () => {
    const r = twr([v(day(0), "0"), v(day(1), "100"), v(day(2), "110")], []);
    expect(r.twr?.toFixed()).toBe("0.1");
    expect(r.skipped).toEqual([{ from: day(0), to: day(1), reason: "non_positive_start" }]);
    expect(r.from).toBe(day(1));
    // A full start-of-day withdrawal leaves nothing invested in that sub-period.
    const out = twr([v(day(0), "100"), v(day(1), "0")], [f(day(1), "-100")]);
    expect(out.twr).toBeNull();
    expect(out.from).toBeNull();
    expect(out.skipped).toHaveLength(1);
    expect(twr([], [f(day(0), "1")]).ignored).toEqual([f(day(0), "1")]);
    // One valuation is no sub-period at all.
    expect(twr([v(day(0), "100")], [f(day(0), "100")])).toEqual({
      twr: null,
      from: null,
      to: null,
      subPeriods: [],
      skipped: [],
      ignored: [],
    });
  });

  it("rejects duplicate dates and negative values", () => {
    expect(() => twr([v(day(0), "1"), v(day(0), "2")], [])).toThrow(/invalid_input/);
    expect(() => twr([v(day(0), "-1")], [])).toThrow(/invalid_input/);
    expect(() => twr([v(day(0), "abc")], [])).toThrow(/invalid_decimal/);
  });

  const value = fc.integer({ min: 1, max: 100000 }).map((n) => new KernelDecimal(n).div(100));
  const series = fc.array(value, { minLength: 2, maxLength: 12 }).map((vs) => vs.map((x, i) => v(day(i), x.toFixed())));

  it("property: a zero flow is a no-op", () => {
    fc.assert(
      fc.property(series, fc.integer({ min: 1, max: 11 }), (vs, i) => {
        if (i >= vs.length) return;
        const a = twr(vs, []);
        const b = twr(vs, [f(vs[i].date, "0")]);
        expect(b.twr?.toFixed()).toBe(a.twr?.toFixed());
      }),
    );
  });

  it("property: a deposit bought at the previous close scales every later valuation and leaves TWR unchanged", () => {
    fc.assert(
      fc.property(series, fc.integer({ min: 1, max: 11 }), fc.integer({ min: 1, max: 100000 }), (vs, i, dep) => {
        if (i >= vs.length) return;
        const deposit = new KernelDecimal(dep).div(100);
        const prev = new KernelDecimal(vs[i - 1].value);
        const scale = ONE.plus(deposit.div(prev));
        const scaled = vs.map((p, j) => (j >= i ? v(p.date, new KernelDecimal(p.value).times(scale).toFixed()) : p));
        const a = twr(vs, []);
        const b = twr(scaled, [f(vs[i].date, deposit.toFixed())]);
        if (a.twr === null || b.twr === null) throw new Error("expected a return");
        expect(b.twr.minus(a.twr).abs().lt("1e-30")).toBe(true);
      }),
    );
  });

  it("property: chaining — twr(a→c) = (1 + twr(a→b))(1 + twr(b→c)) − 1 at any valuation date b", () => {
    const flows = fc.array(fc.tuple(fc.integer({ min: 1, max: 11 }), fc.integer({ min: -5000, max: 20000 })), {
      maxLength: 4,
    });
    fc.assert(
      fc.property(series, fc.integer({ min: 1, max: 10 }), flows, (vs, b, fl) => {
        if (b >= vs.length - 1) return;
        const fs = fl
          .filter(([i]) => i < vs.length)
          .map(([i, amt]) => f(vs[i].date, new KernelDecimal(amt).div(100).toFixed()));
        const whole = twr(vs, fs);
        const left = twr(vs.slice(0, b + 1), fs);
        const right = twr(vs.slice(b), fs);
        // Only compare when nothing was skipped: a skipped sub-period breaks the chain by definition.
        if (whole.skipped.length > 0 || left.twr === null || right.twr === null || whole.twr === null) return;
        const chained = ONE.plus(left.twr).times(ONE.plus(right.twr)).minus(ONE);
        expect(chained.minus(whole.twr).abs().lt("1e-30")).toBe(true);
      }),
    );
  });
});
