/**
 * One function per closed `SeriesKind` (docs/milestone-2-plan.md "Series
 * kinds"). Consumers pick the function that matches the descriptor's kind:
 *
 *   rate_daily / rate_annual → compoundRate        (rate.ts)
 *   index_level              → levelAt, indexReturn (index-level.ts)
 *   inflation_index          → inflationLevelAt     (inflation.ts)
 *   fx_rate                  → fxRateAt             (fx-rate.ts)
 *   yield_curve              → curveAt, rateAtTenor, discountFactor (yield-curve.ts)
 *
 * Every function returns a status-carrying result, never NaN.
 */
export { compoundRate, type CompoundResult, type RateKind } from "./rate";
export { indexReturn, levelAt } from "./index-level";
export { INFLATION_CARRY_DAYS, inflationLevelAt, type Interpolation } from "./inflation";
export { fxRateAt } from "./fx-rate";
export { curveAt, discountFactor, rateAtTenor, type Curve, type CurvePoint } from "./yield-curve";
