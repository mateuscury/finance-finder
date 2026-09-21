/**
 * Time-weighted return (docs/milestone-2-plan.md "TWR"; MILESTONES.md §2
 * decisions 1, 2, 16).
 *
 * Currency-agnostic: valuations and flows arrive ALREADY in base currency and
 * this module knows nothing about assets. Sub-periods are consecutive
 * valuation dates. For each pair `(d₋₁, d)`:
 *
 *   r = V_d / (V_{d−1} + CF_d) − 1
 *
 * where `CF_d` is the sum of external flows attached to `d` — the START-OF-DAY
 * convention (decision 1): a flow dated `D` is in the portfolio before `D`'s
 * valuation, so a same-day deposit-and-buy reports 0%, not a spurious gain.
 *
 * A flow dated on a non-valuation date attaches to the first valuation date
 * ≥ its date. Flows dated on or before the FIRST valuation date are part of
 * `V₀` and attach nowhere; flows after the LAST valuation date are outside the
 * window and reported in `ignored` (decision 16). A sub-period whose
 * denominator is ≤ 0 is skipped and reported, never divided (decision 2), so a
 * ledger with no recorded deposits still yields a defined number from the
 * first valuation with positive value.
 */
import type { DecimalString, IsoDate } from "@/packs/types";
import { ONE, ZERO, parseDecimal, type KDecimal } from "./decimal";
import { compareDates } from "./dates";
import { KernelError } from "./errors";

export interface ValuationPoint {
  date: IsoDate;
  /** Base currency; never negative. */
  value: DecimalString;
}

/** An external flow in base currency: positive deposit, negative withdrawal. */
export interface BaseFlow {
  date: IsoDate;
  amount: DecimalString;
}

export interface SubPeriod {
  from: IsoDate;
  to: IsoDate;
  startValue: KDecimal;
  /** Σ external flows attached to `to`. */
  flow: KDecimal;
  endValue: KDecimal;
  return: KDecimal;
}

export interface SkippedSubPeriod {
  from: IsoDate;
  to: IsoDate;
  reason: "non_positive_start";
}

export interface TwrResult {
  /** Null only when no sub-period survived. */
  twr: KDecimal | null;
  /** Span the chain covers: first surviving sub-period's start to the last's end. */
  from: IsoDate | null;
  to: IsoDate | null;
  subPeriods: readonly SubPeriod[];
  skipped: readonly SkippedSubPeriod[];
  /** Flows dated after the last valuation date. */
  ignored: readonly BaseFlow[];
}

function sortedValuations(valuations: readonly ValuationPoint[]): { date: IsoDate; value: KDecimal }[] {
  const rows = valuations.map((v) => ({ date: v.date, value: parseDecimal(v.value, "valuation") }));
  rows.sort((a, b) => compareDates(a.date, b.date));
  for (let i = 0; i < rows.length; i += 1) {
    if (rows[i].value.lt(0))
      throw new KernelError("invalid_input", "a valuation cannot be negative", { date: rows[i].date });
    if (i > 0 && rows[i].date === rows[i - 1].date)
      throw new KernelError("invalid_input", "two valuations on one date", { date: rows[i].date });
  }
  return rows;
}

/** Sum of flows per valuation date it attaches to, plus the flows outside the window. */
function attachFlows(
  dates: readonly IsoDate[],
  flows: readonly BaseFlow[],
): { attached: Map<IsoDate, KDecimal>; ignored: BaseFlow[] } {
  const attached = new Map<IsoDate, KDecimal>();
  const ignored: BaseFlow[] = [];
  const first = dates[0];
  const last = dates[dates.length - 1];
  for (const flow of flows) {
    const amount = parseDecimal(flow.amount, "flow");
    if (compareDates(flow.date, first) <= 0) continue; // part of V₀
    if (compareDates(flow.date, last) > 0) {
      ignored.push(flow);
      continue;
    }
    // Dates are ascending: the first one at or after the flow's date.
    const target = dates.find((d) => compareDates(d, flow.date) >= 0)!;
    attached.set(target, (attached.get(target) ?? ZERO).plus(amount));
  }
  return { attached, ignored };
}

export function twr(valuations: readonly ValuationPoint[], flows: readonly BaseFlow[]): TwrResult {
  const rows = sortedValuations(valuations);
  if (rows.length === 0) return { twr: null, from: null, to: null, subPeriods: [], skipped: [], ignored: [...flows] };

  const dates = rows.map((r) => r.date);
  const { attached, ignored } = attachFlows(dates, flows);
  const subPeriods: SubPeriod[] = [];
  const skipped: SkippedSubPeriod[] = [];
  let growth: KDecimal = ONE;

  for (let i = 1; i < rows.length; i += 1) {
    const prev = rows[i - 1];
    const cur = rows[i];
    const flow = attached.get(cur.date) ?? ZERO;
    const denominator = prev.value.plus(flow);
    if (!denominator.gt(0)) {
      skipped.push({ from: prev.date, to: cur.date, reason: "non_positive_start" });
      continue;
    }
    const r = cur.value.div(denominator).minus(ONE);
    subPeriods.push({ from: prev.date, to: cur.date, startValue: prev.value, flow, endValue: cur.value, return: r });
    growth = growth.times(ONE.plus(r));
  }

  if (subPeriods.length === 0) return { twr: null, from: null, to: null, subPeriods, skipped, ignored };
  return {
    twr: growth.minus(ONE),
    from: subPeriods[0].from,
    to: subPeriods[subPeriods.length - 1].to,
    subPeriods,
    skipped,
    ignored,
  };
}
