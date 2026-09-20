/**
 * Kernel errors — a CLOSED code set (docs/milestone-2-plan.md Phase 1).
 *
 * A `KernelError` means the INPUT violated a contract: a value that is not a
 * decimal string, money in two currencies, a sell beyond the open position.
 * Data that is merely missing or stale is never an error; it is a status on
 * the result (`stale`, `unpriced` with a reason code) so a screen can show it.
 *
 * `details` carries ids, dates and codes only — never a value — because these
 * messages end up in logs (SPEC §12).
 */

export type KernelErrorCode =
  /** A string that is not a plain decimal (`DecimalStringSchema`). */
  | "invalid_decimal"
  /** A string that is not a real "YYYY-MM-DD" calendar date. */
  | "invalid_date"
  /** A currency that is not three upper-case letters. */
  | "invalid_currency"
  /** Money arithmetic across two currencies. */
  | "currency_mismatch"
  /** A sell larger than the open position on that date. */
  | "oversell"
  /** A (dayCount, compounding, series kind) combination the kernel does not define. */
  | "unsupported_convention"
  /** Any other contract violation in a kernel input row. */
  | "invalid_input";

export class KernelError extends Error {
  readonly code: KernelErrorCode;
  readonly details: Readonly<Record<string, string | number | null>>;

  constructor(code: KernelErrorCode, message: string, details: Record<string, string | number | null> = {}) {
    super(`${code}: ${message}`);
    this.name = "KernelError";
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export function isKernelError(err: unknown, code?: KernelErrorCode): err is KernelError {
  return err instanceof KernelError && (code === undefined || err.code === code);
}
