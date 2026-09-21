/**
 * Money-weighted return — XIRR (docs/milestone-2-plan.md "MWR / XIRR";
 * MILESTONES.md §2 decisions 2 and 16).
 *
 * `xirr` solves Σ CF_i / (1 + r)^(t_i) = 0 with `t_i = (date_i − date_0) / 365`
 * (ACT/365, Excel-compatible; `date_0` the earliest date in the stream).
 * Newton from 0.1, at most 50 iterations, stop when |Δr| < 1e-20; bisection
 * when Newton leaves (−0.999999, 1e6), meets a flat derivative or does not
 * converge, over a bracket found by scanning [−0.999999, 10] for a sign
 * change. No sign change → null with `no_root`. A stream without at least one
 * negative and one positive amount, or whose flows all fall on ONE date (no
 * time to discount across — the NPV is then a constant, and a constant zero
 * would make every rate a root) → null with `insufficient_flows`. The rate
 * is annualised even for periods under a year, as XIRR is.
 *
 * `mwr` builds the stream from a valuation window: −startValue at `from` when
 * positive; each external flow in `(from, to]` with its sign FLIPPED (a deposit
 * is money the investor puts in); +endValue at `to`. Flows dated ≤ `from` are
 * part of `startValue`; flows after `to` are outside the window and reported
 * in `ignored`, exactly as `twr` treats them (decision 16).
 */
import type { DecimalString, IsoDate } from "@/packs/types";
import { KernelDecimal, ONE, ZERO, parseDecimal, type KDecimal } from "./decimal";
import { compareDates, daysBetween, inWindow } from "./dates";
import { KernelError } from "./errors";
import type { BaseFlow } from "./twr";

export interface XirrFlow {
  date: IsoDate;
  amount: KDecimal;
}

export type XirrResult =
  { status: "ok"; rate: KDecimal } | { status: "null"; reason: "insufficient_flows" | "no_root" };

const NEWTON_START = new KernelDecimal("0.1");
const NEWTON_MAX_ITERATIONS = 50;
// The plan said 1e-14. A near-total loss puts the root where |NPV′| ~ 1e15, and
// a 1e-14 step still left a 1e-10 NPV residual — violating the plan's own
// |NPV| < 1e-10 property. Quadratic convergence makes 1e-20 one extra step.
const NEWTON_TOLERANCE = new KernelDecimal("1e-20");
const LOWER_BOUND = new KernelDecimal("-0.999999");
const UPPER_BOUND = new KernelDecimal("1e6");
const FLAT_DERIVATIVE = new KernelDecimal("1e-30");
const BISECTION_GRID = [
  "-0.999999",
  "-0.99",
  "-0.9",
  "-0.75",
  "-0.5",
  "-0.25",
  "0",
  "0.1",
  "0.25",
  "0.5",
  "1",
  "2",
  "5",
  "10",
].map((s) => new KernelDecimal(s));
const BISECTION_MAX_ITERATIONS = 300;
// Near r = −1 the NPV is steep (|f′| ~ 1e15 for a near-total loss over a few
// years), so the bracket must close far tighter than the 1e-10 NPV property:
// 1e-30 is ~103 halvings from the widest bracket and inside precision 40.
const BISECTION_TOLERANCE = new KernelDecimal("1e-30");

interface Timed {
  amount: KDecimal;
  years: KDecimal;
}

function npv(flows: readonly Timed[], rate: KDecimal): KDecimal {
  const growth = ONE.plus(rate);
  return flows.reduce((sum, f) => sum.plus(f.amount.times(growth.pow(f.years.negated()))), ZERO);
}

/** NPV and its derivative from ONE `pow` per flow: d/dr [CF·g^(−t)] = −t·CF·g^(−t) / g. */
function evaluate(flows: readonly Timed[], rate: KDecimal): { value: KDecimal; derivative: KDecimal } {
  const growth = ONE.plus(rate);
  let value: KDecimal = ZERO;
  let derivative: KDecimal = ZERO;
  for (const f of flows) {
    const discounted = f.amount.times(growth.pow(f.years.negated()));
    value = value.plus(discounted);
    derivative = derivative.minus(discounted.times(f.years).div(growth));
  }
  return { value, derivative };
}

function newton(flows: readonly Timed[]): KDecimal | null {
  let rate = NEWTON_START;
  for (let i = 0; i < NEWTON_MAX_ITERATIONS; i += 1) {
    const { value, derivative } = evaluate(flows, rate);
    if (derivative.abs().lt(FLAT_DERIVATIVE)) return null;
    const next = rate.minus(value.div(derivative));
    if (next.lte(LOWER_BOUND) || next.gt(UPPER_BOUND)) return null;
    if (next.minus(rate).abs().lt(NEWTON_TOLERANCE)) return next;
    rate = next;
  }
  return null;
}

function bisection(flows: readonly Timed[]): KDecimal | null {
  let lo: KDecimal | null = null;
  let hi: KDecimal | null = null;
  let loSign = 0;
  for (let i = 0; i < BISECTION_GRID.length; i += 1) {
    const value = npv(flows, BISECTION_GRID[i]);
    if (value.isZero()) return BISECTION_GRID[i];
    const sign = value.isNegative() ? -1 : 1;
    if (i > 0 && sign !== loSign) {
      lo = BISECTION_GRID[i - 1];
      hi = BISECTION_GRID[i];
      break;
    }
    loSign = sign;
  }
  if (lo === null || hi === null) return null;
  for (let i = 0; i < BISECTION_MAX_ITERATIONS && hi.minus(lo).gt(BISECTION_TOLERANCE); i += 1) {
    const mid = lo.plus(hi).div(2);
    const value = npv(flows, mid);
    if (value.isZero()) return mid;
    if ((value.isNegative() ? -1 : 1) === loSign) lo = mid;
    else hi = mid;
  }
  return lo.plus(hi).div(2);
}

export function xirr(stream: readonly XirrFlow[]): XirrResult {
  if (!stream.some((f) => f.amount.isNegative()) || !stream.some((f) => f.amount.gt(0))) {
    return { status: "null", reason: "insufficient_flows" };
  }
  const origin = stream.reduce((min, f) => (compareDates(f.date, min) < 0 ? f.date : min), stream[0].date);
  // Every flow on one date: t = 0 throughout, so NPV does not depend on the
  // rate at all. A zero sum would otherwise return the bracket's first grid
  // point as if it were the answer.
  if (stream.every((f) => f.date === origin)) return { status: "null", reason: "insufficient_flows" };
  const flows: Timed[] = stream.map((f) => ({
    amount: f.amount,
    years: new KernelDecimal(daysBetween(origin, f.date)).div(365),
  }));
  const rate = newton(flows) ?? bisection(flows);
  return rate === null ? { status: "null", reason: "no_root" } : { status: "ok", rate };
}

export interface MwrInput {
  from: IsoDate;
  to: IsoDate;
  /** Base currency, ≥ 0. */
  startValue: DecimalString;
  /** External flows in base currency; only those in `(from, to]` enter the stream. */
  flows: readonly BaseFlow[];
  endValue: DecimalString;
}

/** The XIRR outcome plus the flows dated after `to`, which the window could not use. */
export type MwrResult = XirrResult & { ignored: readonly BaseFlow[] };

export function mwr(input: MwrInput): MwrResult {
  if (compareDates(input.from, input.to) > 0)
    throw new KernelError("invalid_input", "mwr needs from ≤ to", { from: input.from, to: input.to });
  const startValue = parseDecimal(input.startValue, "startValue");
  const endValue = parseDecimal(input.endValue, "endValue");
  const stream: XirrFlow[] = [];
  const ignored: BaseFlow[] = [];
  if (startValue.gt(0)) stream.push({ date: input.from, amount: startValue.negated() });
  for (const flow of input.flows) {
    if (inWindow(flow.date, input.from, input.to))
      stream.push({ date: flow.date, amount: parseDecimal(flow.amount, "flow").negated() });
    else if (compareDates(flow.date, input.to) > 0) ignored.push(flow);
    // else: dated ≤ from, part of startValue.
  }
  stream.push({ date: input.to, amount: endValue });
  return { ...xirr(stream), ignored };
}
