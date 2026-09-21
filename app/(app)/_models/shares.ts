/**
 * Shares of a whole that sum to EXACTLY 100.00 when shown with two decimals
 * (US-011 AC-011.1): each share is rounded to basis points, and the basis
 * points the rounding lost are given to the largest remainders. Every
 * figure is the kernel's Decimal; the result is unit shares as decimal
 * strings ("0.4567" = 45.67 %), which `formatShare` prints.
 */
import { Decimal } from "decimal.js";
import { KernelDecimal, toDecimalString, ZERO } from "@/lib/calc/decimal";

const BASIS_POINTS = new KernelDecimal(10000);

export function sharesSummingTo100(values: readonly string[]): string[] {
  const parts = values.map((v) => new KernelDecimal(v));
  const whole = parts.reduce((s, p) => s.plus(p), ZERO);
  if (whole.lte(0) || parts.length === 0) return parts.map(() => "0");
  const exact = parts.map((p) => p.div(whole).times(BASIS_POINTS));
  const floors = exact.map((e) => e.toDecimalPlaces(0, Decimal.ROUND_FLOOR));
  let remaining = BASIS_POINTS.minus(floors.reduce((s, f) => s.plus(f), ZERO)).toNumber();
  const order = exact
    .map((e, i) => ({ i, remainder: e.minus(floors[i]) }))
    .sort((a, b) => b.remainder.comparedTo(a.remainder) || a.i - b.i);
  const bp = [...floors];
  for (const { i } of order) {
    if (remaining <= 0) break;
    bp[i] = bp[i].plus(1);
    remaining -= 1;
  }
  return bp.map((b) => toDecimalString(b.div(BASIS_POINTS)));
}
