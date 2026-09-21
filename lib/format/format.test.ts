import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  formatChange,
  formatDate,
  formatDecimal,
  formatMoney,
  formatMonth,
  formatPercent,
  formatPrice,
  formatQuantity,
  formatShare,
} from "./index";

/** Intl's own rendering, normalised for the spaces and minus glyphs it varies between versions. */
const norm = (s: string) => s.replace(/[  ]/g, " ").replace(/[−-]/g, "−");

const LOCALES = ["pt-BR", "en-GB", "en-US"] as const;

describe("money", () => {
  it("places the symbol, the sign and the separators as the locale does", () => {
    expect(norm(formatMoney("1234567.891", "BRL", "pt-BR"))).toBe("R$ 1.234.567,89");
    expect(norm(formatMoney("1234567.891", "BRL", "en-GB"))).toBe("R$1,234,567.89");
    expect(norm(formatMoney("-1234.5", "BRL", "pt-BR"))).toBe("−R$ 1.234,50");
    expect(norm(formatMoney("-1234.5", "USD", "en-US"))).toBe("−$1,234.50");
    expect(norm(formatMoney("0", "BRL", "pt-BR"))).toBe("R$ 0,00");
  });

  it("rounds half to even by the kernel's rule, never by the float's", () => {
    expect(norm(formatMoney("2.675", "BRL", "en-GB"))).toBe("R$2.68");
    expect(norm(formatMoney("2.665", "BRL", "en-GB"))).toBe("R$2.66");
    expect(norm(formatMoney("-0.004", "BRL", "en-GB"))).toBe("R$0.00");
  });

  it("prints a 30-digit total exactly, where a float would round", () => {
    const big = "123456789012345678901234567890.12";
    expect(norm(formatMoney(big, "BRL", "en-GB"))).toBe("R$123,456,789,012,345,678,901,234,567,890.12");
    expect(norm(formatMoney(big, "BRL", "pt-BR"))).toBe("R$ 123.456.789.012.345.678.901.234.567.890,12");
  });

  it("property: for a value a float represents exactly to two decimals, the output equals Intl's own", () => {
    fc.assert(
      fc.property(fc.integer({ min: -(10 ** 12), max: 10 ** 12 }), fc.constantFrom(...LOCALES), (cents, locale) => {
        const value = `${cents < 0 ? "-" : ""}${Math.abs(Math.trunc(cents / 100))}.${String(Math.abs(cents % 100)).padStart(2, "0")}`;
        const intl = new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" }).format(cents / 100);
        expect(norm(formatMoney(value, "BRL", locale))).toBe(norm(intl));
      }),
    );
  });

  it("formatChange carries the direction and an explicit plus", () => {
    expect(formatChange("12.5", "BRL", "en-GB")).toEqual({
      text: expect.stringMatching(/^\+R\$12\.50$/),
      direction: "pos",
    });
    expect(formatChange("-12.5", "BRL", "en-GB").direction).toBe("neg");
    expect(formatChange("0.001", "BRL", "en-GB")).toEqual({
      text: expect.stringMatching(/R\$0\.00$/),
      direction: "zero",
    });
    expect(norm(formatChange("0.001", "BRL", "en-GB").text)).not.toMatch(/^\+/);
  });
});

describe("percent and share", () => {
  it("scales a unit rate, keeps two decimals, signs always by default", () => {
    expect(norm(formatPercent("0.1234", "pt-BR").text)).toBe("+12,34%");
    expect(norm(formatPercent("-0.05", "en-GB").text)).toBe("−5.00%");
    expect(formatPercent("0.00001", "en-GB")).toEqual({ text: expect.stringMatching(/0\.00%$/), direction: "zero" });
    expect(norm(formatShare("0.4567", "pt-BR"))).toBe("45,67%");
  });

  it("property: agrees with Intl for rates with at most two percentage decimals (no rounding in play)", () => {
    // Four decimals of the unit rate = two of the percentage: nothing to round,
    // so the float oracle cannot disagree. At a rounding boundary it can — see below.
    fc.assert(
      fc.property(fc.integer({ min: -9999, max: 9999 }), fc.constantFrom(...LOCALES), (units, locale) => {
        const rate = `${units < 0 ? "-" : ""}0.${String(Math.abs(units)).padStart(4, "0")}`;
        const intl = new Intl.NumberFormat(locale, {
          style: "percent",
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
          signDisplay: "always",
        }).format(units / 10000);
        expect(norm(formatPercent(rate, locale).text)).toBe(norm(intl).replace(/^\+0([.,]00%)$/, "0$1"));
      }),
    );
  });

  it("rounds the exact decimal, where the float oracle rounds its own approximation", () => {
    // 0.27625 is exactly halfway in decimal: half-to-even gives 27.62. As a
    // double it is slightly below, and Intl says 27.63 — the divergence that
    // is the whole reason this module never goes through a float.
    expect(norm(formatPercent("-0.27625", "pt-BR").text)).toBe("−27,62%");
    expect(norm(formatPercent("0.27635", "en-GB").text)).toBe("+27.64%");
  });
});

describe("quantities, prices and plain decimals", () => {
  it("trims trailing zeros to the minimum and keeps up to ten decimals", () => {
    expect(formatQuantity("100.0000000000", "en-GB")).toBe("100");
    expect(formatQuantity("0.1234567891", "en-GB")).toBe("0.1234567891");
    expect(formatQuantity("-30", "pt-BR")).toBe("−30");
    expect(formatPrice("162.4", "pt-BR")).toBe("162,40");
    expect(formatPrice("0.000123456789", "en-GB")).toBe("0.0001234568");
    expect(formatDecimal("1234.5", "pt-BR", { minFraction: 0, maxFraction: 1 })).toBe("1.234,5");
  });

  it("never prints a negative zero", () => {
    expect(formatQuantity("-0", "en-GB")).toBe("0");
    expect(formatDecimal("-0.00001", "en-GB", { minFraction: 2, maxFraction: 2 })).toBe("0.00");
  });
});

describe("dates", () => {
  it("formats a calendar day in the locale without a time-zone shift", () => {
    expect(formatDate("2026-02-27", "en-GB")).toBe("27 Feb 2026");
    expect(formatDate("2026-02-27", "pt-BR")).toMatch(/27 de fev\.? de 2026/);
    expect(formatDate("2026-02-27", "en-GB", "long")).toBe("27 February 2026");
    expect(formatMonth("2026-02-27", "en-GB")).toBe("Feb 2026");
    // The first day of a month stays the first day of that month in every locale.
    expect(formatDate("2026-03-01", "en-US")).toBe("Mar 1, 2026");
  });
});
