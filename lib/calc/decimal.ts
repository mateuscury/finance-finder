/**
 * The kernel-private Decimal (docs/milestone-2-plan.md "Arithmetic").
 *
 * `Decimal.clone` gives this module its own constructor with its own
 * configuration. `Decimal.set` on the global class would be an action at a
 * distance on every other consumer of decimal.js in the process; lint bans it
 * inside lib/calc.
 *
 * precision 40 / ROUND_HALF_EVEN: forty significant digits is far past the
 * ten stored by `numeric(24,10)` and past any golden tolerance, so rounding
 * inside a chain of factors never surfaces. Half-even is the banker's rounding
 * the database boundary also uses. The boundary rounds; the kernel never does.
 */
import Decimal from "decimal.js";
import { DecimalStringSchema } from "@/packs/schema";
import { KernelError } from "./errors";

export const KernelDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_EVEN,
  // Wide exponent bounds so toString() never switches to exponent form for
  // anything a portfolio can contain; toDecimalString() uses toFixed anyway.
  toExpNeg: -40,
  toExpPos: 40,
});

export type KDecimal = InstanceType<typeof KernelDecimal>;

export const ZERO: KDecimal = new KernelDecimal(0);
export const ONE: KDecimal = new KernelDecimal(1);

/**
 * The only way a string becomes a Decimal inside the kernel. Anything that is
 * not a plain decimal string ("12", "-0.5", "1234.5678") is `invalid_decimal`
 * — never a coercion, never a float on the way in.
 */
export function parseDecimal(input: string, field = "value"): KDecimal {
  if (!DecimalStringSchema.safeParse(input).success) {
    // The offending text is deliberately NOT in the message: it may be a value.
    throw new KernelError("invalid_decimal", `${field} is not a plain decimal string`, { field });
  }
  return new KernelDecimal(input);
}

/**
 * Canonical decimal string for the kernel boundary: no exponent, no trailing
 * fractional zeros, no "-0". `toFixed()` never produces exponent form;
 * `toString()` does outside toExpNeg/toExpPos.
 */
export function toDecimalString(value: Decimal): string {
  if (value.isZero()) return "0";
  const fixed = value.toFixed();
  if (!fixed.includes(".")) return fixed;
  const trimmed = fixed.replace(/0+$/, "");
  return trimmed.endsWith(".") ? trimmed.slice(0, -1) : trimmed;
}

/** True when `input` would be accepted by `parseDecimal`. */
export function isDecimalString(input: unknown): input is string {
  return typeof input === "string" && DecimalStringSchema.safeParse(input).success;
}
