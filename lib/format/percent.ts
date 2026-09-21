import { Decimal } from "decimal.js";
import { KernelDecimal } from "@/lib/calc/decimal";
import { digitRun, fillTemplate, signFor, type DigitsOptions } from "./number";

const PERCENT_DECIMALS = 2;
const templateCache = new Map<string, Intl.NumberFormatPart[]>();

function percentTemplate(locale: string): Intl.NumberFormatPart[] {
  let t = templateCache.get(locale);
  if (!t) {
    t = new Intl.NumberFormat(locale, {
      style: "percent",
      signDisplay: "always",
      minimumFractionDigits: 1,
    }).formatToParts(-0.015);
    templateCache.set(locale, t);
  }
  return t;
}

/**
 * A unit rate ("0.1234" = 12.34 %) as a percentage with two decimals. Returns
 * the text and the direction, like `formatChange`, because a return is a
 * change too. Default sign "always": a return always shows which way.
 */
export function formatPercent(
  unitRate: string,
  locale: string,
  sign: DigitsOptions["sign"] = "always",
): { text: string; direction: "pos" | "neg" | "zero" } {
  const scaled = new KernelDecimal(unitRate).times(100);
  const rounded = scaled.toDecimalPlaces(PERCENT_DECIMALS, Decimal.ROUND_HALF_EVEN);
  const { negative, run } = digitRun(scaled.toFixed(), locale, {
    minFraction: PERCENT_DECIMALS,
    maxFraction: PERCENT_DECIMALS,
  });
  const direction = rounded.isZero() ? "zero" : rounded.isNegative() ? "neg" : "pos";
  return { text: fillTemplate(percentTemplate(locale), run, signFor(negative, rounded.isZero(), sign)), direction };
}

/** A share of a whole ("0.4567" → "45,67 %"), never signed. */
export function formatShare(unitShare: string, locale: string): string {
  return formatPercent(unitShare, locale, "never").text;
}
