import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { KernelDecimal } from "@/lib/calc/decimal";
import { sharesSummingTo100 } from "./shares";

describe("sharesSummingTo100", () => {
  it("gives the lost basis points to the largest remainders", () => {
    // 1/3 each: 33.33 + 33.33 + 33.34.
    expect(sharesSummingTo100(["1", "1", "1"])).toEqual(["0.3334", "0.3333", "0.3333"]);
    expect(sharesSummingTo100(["50", "50"])).toEqual(["0.5", "0.5"]);
    expect(sharesSummingTo100(["0", "0"])).toEqual(["0", "0"]);
    expect(sharesSummingTo100([])).toEqual([]);
  });

  it("property: two-decimal shares of any positive vector sum to exactly 100.00 and each is within 0.01 of exact", () => {
    fc.assert(
      fc.property(fc.array(fc.integer({ min: 1, max: 10 ** 9 }), { minLength: 1, maxLength: 12 }), (ints) => {
        const values = ints.map((n) => `${n}.${(n * 7) % 100}`);
        const shares = sharesSummingTo100(values);
        const sum = shares.reduce((s, x) => s.plus(x), new KernelDecimal(0));
        expect(sum.eq(1)).toBe(true);
        const whole = values.reduce((s, v) => s.plus(v), new KernelDecimal(0));
        shares.forEach((s, i) => {
          const exact = new KernelDecimal(values[i]).div(whole);
          expect(new KernelDecimal(s).minus(exact).abs().lt("0.0001")).toBe(true);
        });
      }),
    );
  });
});
