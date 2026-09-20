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
export * from "./staleness";
export * from "./positions";
export * from "./series";
export * from "./fx";
export * from "./valuation";
export * from "./portfolio";
export * from "./twr";
export * from "./mwr";
export * from "./contribution";
export * from "./attribution";
export * from "./real";
