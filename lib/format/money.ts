import { Decimal } from "decimal.js";
import { KernelDecimal } from "@/lib/calc/decimal";
import { digitRun, fillTemplate, signFor, type DigitsOptions } from "./number";

const MONEY_DECIMALS = 2;
const templateCache = new Map<string, Intl.NumberFormatPart[]>();

/** Where the locale puts the symbol and the sign for this currency; the digits are ours. */
function moneyTemplate(locale: string, currency: string): Intl.NumberFormatPart[] {
  const key = `${locale}|${currency}`;
  let t = templateCache.get(key);
  if (!t) {
    t = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "symbol",
      signDisplay: "always",
      minimumFractionDigits: MONEY_DECIMALS,
    }).formatToParts(-1.5);
    templateCache.set(key, t);
  }
  return t;
}

/** "R$ 1.234,56" in pt-BR, "R$1,234.56" in en-GB — always two decimals, sign per `sign`. */
export function formatMoney(
  amount: string,
  currency: string,
  locale: string,
  sign: DigitsOptions["sign"] = "auto",
): string {
  const { negative, run } = digitRun(amount, locale, { minFraction: MONEY_DECIMALS, maxFraction: MONEY_DECIMALS });
  const isZero = new KernelDecimal(amount).toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_EVEN).isZero();
  return fillTemplate(moneyTemplate(locale, currency), run, signFor(negative, isZero, sign));
}

/**
 * A change in money: the formatted text with an explicit sign, and which
 * way it went so a screen can pair `--pos`/`--neg` with an arrow — colour is
 * never the only carrier (SPEC §10).
 */
export function formatChange(
  delta: string,
  currency: string,
  locale: string,
): { text: string; direction: "pos" | "neg" | "zero" } {
  const d = new KernelDecimal(delta).toDecimalPlaces(MONEY_DECIMALS, Decimal.ROUND_HALF_EVEN);
  const direction = d.isZero() ? "zero" : d.isNegative() ? "neg" : "pos";
  return { text: formatMoney(delta, currency, locale, "always"), direction };
}
