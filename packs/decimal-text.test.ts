import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { DecimalStringSchema } from "./schema";
import { decimalFromBrazilianText, plainDecimal, splitCsvLine } from "./decimal-text";

describe("plainDecimal", () => {
  it("trims SIDRA's zero padding without arithmetic", () => {
    expect(plainDecimal("7640.1500000000000")).toBe("7640.15");
    expect(plainDecimal("100.000")).toBe("100");
    expect(plainDecimal("0.0")).toBe("0");
    expect(plainDecimal("007.50")).toBe("7.5");
    expect(plainDecimal("-0.0")).toBe("0");
  });

  it("rejects anything that is not a plain decimal lexeme", () => {
    for (const bad of ["", " ", "1e-3", "NaN", "...", "-", "1,5", "1.2.3", "abc"]) {
      expect(plainDecimal(bad), bad).toBeNull();
    }
  });
});

describe("decimalFromBrazilianText", () => {
  it("converts PTAX and Tesouro money text exactly", () => {
    expect(decimalFromBrazilianText('"5,1564"')).toBe("5.1564");
    expect(decimalFromBrazilianText('"5,157"')).toBe("5.157");
    expect(decimalFromBrazilianText("19795,28")).toBe("19795.28");
    expect(decimalFromBrazilianText("1.234,56")).toBe("1234.56");
    expect(decimalFromBrazilianText("1.234.567,89")).toBe("1234567.89");
    expect(decimalFromBrazilianText("0,03")).toBe("0.03");
    expect(decimalFromBrazilianText("-0,25")).toBe("-0.25");
    expect(decimalFromBrazilianText("42")).toBe("42");
  });

  it("refuses an ambiguous dot rather than guessing three orders of magnitude", () => {
    // In Brazilian notation "1.23" is malformed. Reading it as 1.23 instead of
    // rejecting it would understate a price by ~1000x.
    expect(decimalFromBrazilianText("1.23")).toBeNull();
    expect(decimalFromBrazilianText("1.2345")).toBeNull();
    for (const bad of ["", '""', "-", ",", ",5", "5,", "R$ 5,00", "1 234,56", "5.1564"]) {
      expect(decimalFromBrazilianText(bad), bad).toBeNull();
    }
  });

  it("property: every accepted lexeme is a valid kernel decimal string", () => {
    const brl = fc
      .tuple(fc.boolean(), fc.nat(999999), fc.nat(99))
      .map(([neg, w, f]) => `${neg ? "-" : ""}${w},${String(f).padStart(2, "0")}`);
    fc.assert(
      fc.property(brl, (text) => {
        const v = decimalFromBrazilianText(text);
        expect(v).not.toBeNull();
        expect(DecimalStringSchema.safeParse(v).success).toBe(true);
      }),
    );
  });
});

describe("splitCsvLine", () => {
  it("keeps a quoted comma inside its field", () => {
    expect(splitCsvLine('"5,1564","5,157",2026-09-01 13:06:03.857125', ",")).toEqual([
      "5,1564",
      "5,157",
      "2026-09-01 13:06:03.857125",
    ]);
  });

  it("splits Tesouro's semicolon rows and preserves empty fields", () => {
    expect(splitCsvLine("Tesouro Selic;01/03/2029;04/09/2026;0,03;;19795,28", ";")).toEqual([
      "Tesouro Selic",
      "01/03/2029",
      "04/09/2026",
      "0,03",
      "",
      "19795,28",
    ]);
  });

  it("unescapes a doubled quote", () => {
    expect(splitCsvLine('"a""b",c', ",")).toEqual(['a"b', "c"]);
  });
});
