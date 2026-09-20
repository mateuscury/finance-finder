/**
 * Staleness classification and the status shapes every observation-based
 * result shares (docs/milestone-2-plan.md "Calendar and staleness").
 *
 * An observation dated `d ≤ asOf` is FRESH when `d = asOf`, CARRIED FORWARD
 * when `asOf − d ≤ window`, and STALE beyond that. A stale input produces no
 * value: the consumer reports the last known value and its date, and the
 * portfolio builder excludes it from the confident total (decision 10).
 *
 * Reason codes are fixed literals so the UI and logs never carry free text.
 */
import type { IsoDate } from "@/packs/types";
import { daysBetween } from "./dates";

export type Freshness = "fresh" | "carried_forward" | "stale";

/** `observedOn` must be ≤ `asOf`; the lookup that found it guarantees that. */
export function classify(observedOn: IsoDate, asOf: IsoDate, windowDays: number): Freshness {
  const age = daysBetween(observedOn, asOf);
  if (age === 0) return "fresh";
  return age <= windowDays ? "carried_forward" : "stale";
}

/** Why a value could not be produced. Closed set; extended only by the kernel. */
export type UnpricedReason =
  /** No observation at or before the date. */
  | "no_observation"
  /** A daily rate series has no point for a day it must cover. */
  | "series_gap"
  /** The date precedes an inflation index's first anchor. */
  | "before_first_anchor"
  /** No FX series (direct, inverted or via USD) links the two currencies. */
  | "no_fx_series"
  /** No price for the asset at or before the date. */
  | "no_price"
  /** `curve_mark_to_market` with `indexation` (decision 7). */
  | "indexation_not_supported"
  /** `assets.metadata` fails the pack's schema or lacks a field the strategy needs (decision 4: shown as unpriced, never a crash). */
  | "invalid_metadata"
  /** `curve_mark_to_market` past `maturity`: a past cash flow has no present value. */
  | "matured";

/** Status of a value that exists. Ordered: `ok` < `carried_forward` < `stale`. */
export type ValueStatus = "ok" | "carried_forward" | "stale";

const STATUS_RANK: Record<ValueStatus, number> = { ok: 0, carried_forward: 1, stale: 2 };

/** The worse of two statuses — a number is only as fresh as its least fresh input. */
export function worseOf(a: ValueStatus, b: ValueStatus): ValueStatus {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

/**
 * An observation resolved as of a date. `ok` is fresh; `carried_forward`
 * carries the same value with an older date; `stale` carries the last known
 * value only so it can be SHOWN, never summed.
 */
export type Observed<T> =
  | { status: "ok"; value: T; observedOn: IsoDate }
  | { status: "carried_forward"; value: T; observedOn: IsoDate }
  | { status: "stale"; lastKnown: T; observedOn: IsoDate }
  | { status: "unpriced"; reason: UnpricedReason };

export function observed<T>(value: T, observedOn: IsoDate, asOf: IsoDate, windowDays: number): Observed<T> {
  switch (classify(observedOn, asOf, windowDays)) {
    case "fresh":
      return { status: "ok", value, observedOn };
    case "carried_forward":
      return { status: "carried_forward", value, observedOn };
    case "stale":
      return { status: "stale", lastKnown: value, observedOn };
  }
}

export function unpriced(reason: UnpricedReason): { status: "unpriced"; reason: UnpricedReason } {
  return { status: "unpriced", reason };
}

/** True for `ok` and `carried_forward`: a value that may be used. */
export function hasValue<T>(o: Observed<T>): o is Extract<Observed<T>, { status: "ok" | "carried_forward" }> {
  return o.status === "ok" || o.status === "carried_forward";
}
