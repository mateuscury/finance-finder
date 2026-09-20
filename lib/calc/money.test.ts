import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { KernelDecimal } from "./decimal";
import { isKernelError } from "./errors";
import { Money, assertCurrency } from "./money";

const plainDecimal = fc.stringMatching(/^-?\d{1,20}(\.\d{1,12})?$/);
const brl = (s: string) => Money.parse(s, "BRL");

describe("Money", () => {
  it("parses and prints canonically", () => {
    expect(brl("100.50").toString()).toBe("100.5");
    expect(brl("0.0").toString()).toBe("0");
    expect(Money.zero("USD").toJSON()).toEqual({ amount: "0", currency: "USD" });
  });

  it("validates the currency and never accepts a number", () => {
    expect(() => Money.parse("1", "brl")).toThrow();
    expect(() => Money.parse("1", "BRLL")).toThrow();
    expect(() => assertCurrency("R$")).toThrow();
    try {
      Money.parse("1", "brl");
    } catch (err) {
      expect(isKernelError(err, "invalid_currency")).toBe(true);
    }
    expect(() => Money.parse(1 as unknown as string, "BRL")).toThrow();
  });

  it("throws currency_mismatch on cross-currency add / sub / compare", () => {
    const a = brl("1");
    const b = Money.parse("1", "USD");
    for (const op of [() => a.add(b), () => a.sub(b), () => a.compare(b)]) {
      try {
        op();
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(isKernelError(err, "currency_mismatch")).toBe(true);
        // Currencies are codes, not values — safe to name in the message.
        expect((err as Error).message).toContain("BRL");
        expect((err as Error).message).toContain("USD");
      }
    }
    expect(a.equals(b)).toBe(false);
  });

  it("scales by a Decimal or a decimal string", () => {
    expect(brl("10").scale("1.5").toString()).toBe("15");
    expect(brl("10").scale(new KernelDecimal("0.1")).toString()).toBe("1");
    expect(() => brl("10").scale("abc")).toThrow();
  });

  it("is immutable", () => {
    const m = brl("1");
    expect(Object.isFrozen(m)).toBe(true);
    const n = m.add(brl("1"));
    expect(m.toString()).toBe("1");
    expect(n.toString()).toBe("2");
  });

  it("property: parse ∘ toString ∘ parse is a fixed point", () => {
    fc.assert(
      fc.property(plainDecimal, (s) => {
        const once = brl(s).toString();
        expect(brl(once).toString()).toBe(once);
      }),
    );
  });

  it("property: add and sub are inverse; scaling by 1 is identity; neg twice is identity", () => {
    fc.assert(
      fc.property(plainDecimal, plainDecimal, (x, y) => {
        const a = brl(x);
        const b = brl(y);
        expect(a.add(b).sub(b).equals(a)).toBe(true);
        expect(a.sub(b).add(b).equals(a)).toBe(true);
        expect(a.scale("1").equals(a)).toBe(true);
        expect(a.neg().neg().equals(a)).toBe(true);
        expect(a.add(b).equals(b.add(a))).toBe(true);
      }),
    );
  });

  it("property: compare agrees with subtraction sign, isZero/isNegative agree with compare", () => {
    fc.assert(
      fc.property(plainDecimal, plainDecimal, (x, y) => {
        const a = brl(x);
        const b = brl(y);
        const diff = a.sub(b);
        const sign = diff.isZero() ? 0 : diff.isNegative() ? -1 : 1;
        expect(a.compare(b)).toBe(sign);
        expect(a.compare(a)).toBe(0);
        expect(Money.zero("BRL").isZero()).toBe(true);
        expect(Money.zero("BRL").isNegative()).toBe(false);
      }),
    );
  });

  it("property: no JS number ever appears in a serialised result", () => {
    fc.assert(
      fc.property(plainDecimal, plainDecimal, (x, y) => {
        const json = JSON.parse(JSON.stringify({ a: brl(x), sum: brl(x).add(brl(y)), scaled: brl(x).scale(y) }));
        const walk = (v: unknown): void => {
          if (typeof v === "number") throw new Error("number leaked");
          if (v && typeof v === "object") Object.values(v).forEach(walk);
        };
        walk(json);
        expect(json.a.amount).toMatch(/^-?\d+(\.\d+)?$/);
      }),
    );
  });
});
