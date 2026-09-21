import { formatDecimal } from "./number";

/** Up to ten decimals — the column's own scale — with trailing zeros trimmed; at least the integer. */
export function formatQuantity(quantity: string, locale: string): string {
  return formatDecimal(quantity, locale, { minFraction: 0, maxFraction: 10 });
}

/** A price at its own precision: as many decimals as the string carries, up to ten, trailing zeros trimmed to two. */
export function formatPrice(price: string, locale: string): string {
  return formatDecimal(price, locale, { minFraction: 2, maxFraction: 10 });
}
