import fc from "fast-check";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import { KernelDecimal, ONE, ZERO, isDecimalString, parseDecimal, toDecimalString } from "./decimal";
import { isKernelError } from "./errors";

/** Independent canonicaliser (no kernel code): what a plain decimal string must print as. */
function canonical(s: string): string {
  let neg = s.startsWith("-");
  let body = neg ? s.slice(1) : s;
  let [int, frac = ""] = body.split(".");
  int = int.replace(/^0+(?=\d)/, "");
  frac = frac.replace(/0+$/, "");
  body = frac === "" ? int : `${int}.${frac}`;
  if (body === "0") neg = false;
  return neg ? `-${body}` : body;
}

const plainDecimal = fc.stringMatching(/^-?\d{1,25}(\.\d{1,25})?$/);

describe("KernelDecimal", () => {
  it("is a private clone: configuring it leaves the global Decimal untouched", () => {
    expect(KernelDecimal.precision).toBe(40);
    expect(KernelDecimal.rounding).toBe(Decimal.ROUND_HALF_EVEN);
    expect(Decimal.precision).toBe(20); // decimal.js default
    expect(new KernelDecimal(1).div(3).toFixed()).toBe("0." + "3".repeat(40));
  });

  it("rounds half to even at the 40th digit", () => {
    // 1/3 * 3 under 40 digits is exact 1 again only with enough precision.
    expect(new KernelDecimal(1).div(3).times(3).toFixed()).toBe("0." + "9".repeat(40));
    expect(ZERO.isZero()).toBe(true);
    expect(ONE.toFixed()).toBe("1");
  });
});

describe("parseDecimal", () => {
  it("accepts plain decimal strings and nothing else", () => {
    expect(parseDecimal("12").toFixed()).toBe("12");
    expect(parseDecimal("-0.5").toFixed()).toBe("-0.5");
    expect(parseDecimal("1234.5678").toFixed()).toBe("1234.5678");
    for (const bad of ["1e5", "1.5.5", " 1", "1 ", "NaN", "Infinity", "0x10", "1_000", "", "+1", ".5", "5.", "1,5"]) {
      expect(() => parseDecimal(bad), bad).toThrow();
      try {
        parseDecimal(bad, "price");
      } catch (err) {
        expect(isKernelError(err, "invalid_decimal")).toBe(true);
        // The message names the field, never the offending text.
        expect((err as Error).message).toContain("price");
        if (bad !== "") expect((err as Error).message).not.toContain(bad);
      }
    }
  });

  it("never coerces a number", () => {
    expect(() => parseDecimal(1.5 as unknown as string)).toThrow();
    expect(isDecimalString(1.5)).toBe(false);
    expect(isDecimalString("1.5")).toBe(true);
  });
});

describe("toDecimalString", () => {
  it("property: parse ∘ print is the canonical form of the input", () => {
    fc.assert(
      fc.property(plainDecimal, (s) => {
        expect(toDecimalString(parseDecimal(s))).toBe(canonical(s));
      }),
    );
  });

  it("property: never prints an exponent, whatever the magnitude", () => {
    fc.assert(
      fc.property(plainDecimal, fc.integer({ min: -60, max: 60 }), (s, exp) => {
        const d = parseDecimal(s).times(new KernelDecimal(10).pow(exp));
        const out = toDecimalString(d);
        expect(out).toMatch(/^-?\d+(\.\d+)?$/);
        expect(new KernelDecimal(out).equals(d)).toBe(true);
      }),
    );
  });

  it("prints zero as '0' with no sign", () => {
    expect(toDecimalString(new KernelDecimal("-0"))).toBe("0");
    expect(toDecimalString(new KernelDecimal("0.000"))).toBe("0");
    expect(toDecimalString(new KernelDecimal("100"))).toBe("100");
    expect(toDecimalString(new KernelDecimal("1.10"))).toBe("1.1");
  });
});
