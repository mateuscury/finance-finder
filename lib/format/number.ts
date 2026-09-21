/**
 * Number formatting FROM DECIMAL STRINGS (docs/milestone-4-plan.md
 * "Formatting never goes through a float"). `Intl.NumberFormat` is used as a
 * TEMPLATE — its `formatToParts` on a probe value says where the locale puts
 * the sign, the symbol, the group and decimal separators — and the digits
 * themselves come from the decimal string, rounded by the kernel's Decimal
 * (ROUND_HALF_EVEN, like every other figure). A 30-digit total therefore
 * prints exactly; IEEE 754 never sees it.
 *
 * Grouping is by three digits, which covers every locale this instance ships
 * (Indian 3;2 grouping is not implemented and would need a second probe).
 */
import { Decimal } from "decimal.js";
import { KernelDecimal } from "@/lib/calc/decimal";

export interface DigitsOptions {
  minFraction: number;
  maxFraction: number;
  /** "auto": a minus for negatives only; "always": a plus for positives too; "never": no sign. */
  sign?: "auto" | "always" | "never";
}

interface Separators {
  group: string;
  decimal: string;
}

const separatorCache = new Map<string, Separators>();

/** The locale's group and decimal separators, learned once per locale. */
export function separatorsFor(locale: string): Separators {
  let s = separatorCache.get(locale);
  if (!s) {
    const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567.5);
    s = {
      group: parts.find((p) => p.type === "group")?.value ?? ",",
      decimal: parts.find((p) => p.type === "decimal")?.value ?? ".",
    };
    separatorCache.set(locale, s);
  }
  return s;
}

/** Sign, integer digits and fraction digits of a decimal string rounded to `decimals`. Never a float. */
export function roundedDigits(
  value: string,
  decimals: number,
): { negative: boolean; integer: string; fraction: string } {
  const d = new KernelDecimal(value).toDecimalPlaces(decimals, Decimal.ROUND_HALF_EVEN);
  const negative = d.isNegative() && !d.isZero();
  const fixed = d.abs().toFixed(decimals);
  const [integer, fraction = ""] = fixed.split(".");
  return { negative, integer, fraction };
}

function groupInteger(digits: string, separator: string): string {
  let out = "";
  for (let i = 0; i < digits.length; i += 1) {
    const fromEnd = digits.length - i;
    if (i > 0 && fromEnd % 3 === 0) out += separator;
    out += digits[i];
  }
  return out;
}

/** The unsigned digit run "1.234,56" for a locale; trailing zeros trimmed down to `minFraction`. */
export function digitRun(value: string, locale: string, options: DigitsOptions): { negative: boolean; run: string } {
  const { negative, integer, fraction } = roundedDigits(value, options.maxFraction);
  const sep = separatorsFor(locale);
  let frac = fraction;
  while (frac.length > options.minFraction && frac.endsWith("0")) frac = frac.slice(0, -1);
  const run =
    frac.length > 0 ? `${groupInteger(integer, sep.group)}${sep.decimal}${frac}` : groupInteger(integer, sep.group);
  return { negative, run };
}

/**
 * Fill an Intl template: the probe's numeric parts are replaced by `run`
 * (as one piece), its sign by `sign`, and every other part — currency,
 * percent sign, literal spacing — is kept where the locale put it.
 */
export function fillTemplate(parts: Intl.NumberFormatPart[], run: string, sign: string): string {
  let out = "";
  let numberDone = false;
  for (const part of parts) {
    switch (part.type) {
      case "integer":
      case "group":
      case "decimal":
      case "fraction":
        if (!numberDone) {
          out += run;
          numberDone = true;
        }
        break;
      case "minusSign":
      case "plusSign":
        out += sign;
        break;
      default:
        out += part.value;
    }
  }
  return out;
}

const plainCache = new Map<string, Intl.NumberFormatPart[]>();

function plainTemplate(locale: string): Intl.NumberFormatPart[] {
  let t = plainCache.get(locale);
  if (!t) {
    // signDisplay "always" so the template carries a sign slot; the probe
    // is negative so a locale that places the sign after the number is honoured.
    t = new Intl.NumberFormat(locale, { signDisplay: "always", minimumFractionDigits: 1 }).formatToParts(-1.5);
    plainCache.set(locale, t);
  }
  return t;
}

export function signFor(negative: boolean, isZero: boolean, mode: DigitsOptions["sign"] = "auto"): string {
  if (mode === "never") return "";
  if (negative) return "−";
  return mode === "always" && !isZero ? "+" : "";
}

/** A plain number: "1.234,5" in pt-BR, "1,234.5" in en. */
export function formatDecimal(value: string, locale: string, options: DigitsOptions): string {
  const { negative, run } = digitRun(value, locale, options);
  const isZero = new KernelDecimal(value).toDecimalPlaces(options.maxFraction, Decimal.ROUND_HALF_EVEN).isZero();
  return fillTemplate(plainTemplate(locale), run, signFor(negative, isZero, options.sign));
}
