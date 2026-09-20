import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { KernelDecimal, ONE, type KDecimal } from "./decimal";
import { addDays, daysBetween } from "./dates";
import { mwr, xirr, type XirrFlow } from "./mwr";

const flow = (date: string, amount: string): XirrFlow => ({ date, amount: new KernelDecimal(amount) });
const npv = (stream: XirrFlow[], rate: KDecimal) => {
  const origin = stream.map((f) => f.date).sort()[0];
  return stream.reduce((s, f) => s.plus(f.amount.times(ONE.plus(rate).pow(new KernelDecimal(-daysBetween(origin, f.date)).div(365)))), new KernelDecimal(0));
};

describe("xirr", () => {
  it("one deposit and a terminal value over a 365-day year is the simple growth rate", () => {
    const r = xirr([flow("2026-01-01", "-1000"), flow("2027-01-01", "1100")]);
    if (r.status !== "ok") throw new Error(r.reason);
    expect(r.rate.minus("0.1").abs().lt("1e-12")).toBe(true);
  });

  it("annualises a period shorter than a year", () => {
    // 10% in 73 days = (1.1)^5 − 1 a year.
    const r = xirr([flow("2026-01-01", "-1000"), flow("2026-03-15", "1100")]);
    if (r.status !== "ok") throw new Error(r.reason);
    expect(r.rate.minus(new KernelDecimal("1.1").pow(5).minus(1)).abs().lt("1e-12")).toBe(true);
  });

  it("falls back to bisection when Newton leaves the bracket, and reaches a rate near −1", () => {
    const r = xirr([flow("2026-01-01", "-1000"), flow("2027-01-01", "1")]);
    if (r.status !== "ok") throw new Error(r.reason);
    expect(r.rate.minus("-0.999").abs().lt("1e-12")).toBe(true);
  });

  it("is null with insufficient_flows without one negative and one positive amount", () => {
    expect(xirr([flow("2026-01-01", "100"), flow("2027-01-01", "110")])).toEqual({ status: "null", reason: "insufficient_flows" });
    expect(xirr([flow("2026-01-01", "-100")])).toEqual({ status: "null", reason: "insufficient_flows" });
    expect(xirr([])).toEqual({ status: "null", reason: "insufficient_flows" });
  });

  it("is null with no_root when NPV never changes sign", () => {
    // −100(x² − x + 1) with x = (1 + r)^−1 is negative for every r.
    expect(xirr([flow("2026-01-01", "-100"), flow("2027-01-01", "100"), flow("2028-01-01", "-100")])).toEqual({ status: "null", reason: "no_root" });
  });

  const amount = fc.integer({ min: 100, max: 100000000 }).map((n) => new KernelDecimal(n).div(100));
  const ratio = fc.integer({ min: 50, max: 200 }).map((n) => new KernelDecimal(n).div(100));
  const days = fc.integer({ min: 90, max: 3650 });
  const start = fc.integer({ min: 0, max: 3000 }).map((n) => addDays("2020-01-01", n));

  it("property: deposit D and terminal V after n days solve to (V/D)^(365/n) − 1 within 1e-12", () => {
    fc.assert(
      fc.property(amount, ratio, days, start, (d, k, n, d0) => {
        const v = d.times(k);
        const r = xirr([flow(d0, d.negated().toFixed()), flow(addDays(d0, n), v.toFixed())]);
        if (r.status !== "ok") throw new Error(r.reason);
        const closed = k.pow(new KernelDecimal(365).div(n)).minus(1);
        expect(r.rate.minus(closed).abs().lt("1e-12")).toBe(true);
      }),
    );
  });

  const stream = fc
    .tuple(amount, fc.array(fc.tuple(fc.integer({ min: 1, max: 1500 }), fc.integer({ min: -30000, max: 30000 })), { maxLength: 4 }), ratio, days, start)
    .map(([d, mids, k, n, d0]) => {
      const s = [flow(d0, d.negated().toFixed()), ...mids.map(([off, amt]) => flow(addDays(d0, off), new KernelDecimal(amt).div(100).toFixed())), flow(addDays(d0, 1500 + n), d.times(k).toFixed())];
      return s;
    });

  // Three 40-digit solves per run: fewer runs, longer budget.
  it("property: the solution has |NPV| < 1e-10 and is invariant to scaling amounts and shifting dates", { timeout: 30_000 }, () => {
    fc.assert(
      fc.property(stream, fc.integer({ min: 2, max: 1000 }), fc.integer({ min: -2000, max: 2000 }), (s, scale, shift) => {
        const r = xirr(s);
        if (r.status !== "ok") return; // no_root streams are legitimately null
        expect(npv(s, r.rate).abs().lt("1e-10")).toBe(true);
        const scaled = xirr(s.map((f) => ({ ...f, amount: f.amount.times(scale) })));
        const shifted = xirr(s.map((f) => ({ ...f, date: addDays(f.date, shift) })));
        if (scaled.status !== "ok" || shifted.status !== "ok") throw new Error("expected ok");
        expect(scaled.rate.minus(r.rate).abs().lt("1e-10")).toBe(true);
        expect(shifted.rate.minus(r.rate).abs().lt("1e-10")).toBe(true);
      }),
      { numRuns: 30 },
    );
  });
});

describe("mwr", () => {
  it("builds the stream: −start when positive, flows in (from, to] negated, +end", () => {
    const r = mwr({ from: "2026-01-01", to: "2027-01-01", startValue: "1000", flows: [], endValue: "1100" });
    if (r.status !== "ok") throw new Error(r.reason);
    expect(r.rate.minus("0.1").abs().lt("1e-12")).toBe(true);
    // A deposit on `from` is part of startValue; one on `to` is a flow. The withdrawal is money out.
    const withFlows = mwr({
      from: "2026-01-01",
      to: "2027-01-01",
      startValue: "0",
      flows: [
        { date: "2026-01-01", amount: "999999" },
        { date: "2026-07-02", amount: "1000" },
        { date: "2027-01-02", amount: "999999" },
      ],
      endValue: "1050",
    });
    if (withFlows.status !== "ok") throw new Error(withFlows.reason);
    // 1000 → 1050 in 183 days.
    const closed = new KernelDecimal("1.05").pow(new KernelDecimal(365).div(183)).minus(1);
    expect(withFlows.rate.minus(closed).abs().lt("1e-12")).toBe(true);
    expect(withFlows.ignored).toEqual([{ date: "2027-01-02", amount: "999999" }]);
  });

  it("a ledger with no deposits recorded is null with insufficient_flows (decision 2)", () => {
    expect(mwr({ from: "2026-01-01", to: "2027-01-01", startValue: "0", flows: [], endValue: "1100" })).toEqual({ status: "null", reason: "insufficient_flows", ignored: [] });
  });

  it("rejects from > to", () => {
    expect(() => mwr({ from: "2027-01-01", to: "2026-01-01", startValue: "0", flows: [], endValue: "0" })).toThrow(/invalid_input/);
  });
});
