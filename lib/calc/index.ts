/**
 * lib/calc — the financial kernel. Pure functions over decimal strings.
 * See README.md for the module map and docs/milestone-2-plan.md for the
 * conventions every number here is computed under.
 */
export { KernelDecimal, ZERO, ONE, parseDecimal, toDecimalString, isDecimalString } from "./decimal";
export type { KDecimal } from "./decimal";
export { KernelError, isKernelError } from "./errors";
export type { KernelErrorCode } from "./errors";
export { Money, assertCurrency } from "./money";
export * from "./dates";
export * from "./calendar";
export * from "./types";
