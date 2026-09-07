/**
 * Adapter-output validation (plan §2.3, §3.2; lib/packs/README safety list).
 *
 * `FetchPointSchema` checks SHAPE. This module checks MEANING against the
 * manifest that asked for the data: that an FX point is denominated in the
 * currency its series declares, that a scalar series is not smuggling a
 * currency, that a curve tenor is one the series actually declares, that a
 * price belongs to a ref that was requested, and that nothing is dated in the
 * future.
 *
 * A malformed point is COUNTED AND REJECTED, never coerced. Coercion is how a
 * wrong number reaches a portfolio quietly.
 */
import { FetchPointSchema } from "@/packs/schema";
import type { FetchPoint, InstrumentKind, IsoDate, SeriesDescriptor } from "@/packs/types";

export interface ValidationScope {
  /** Series the requesting pack (and its dependencies) declare. */
  series: ReadonlyMap<string, SeriesDescriptor>;
  /** Asset identifier -> the instrument kind it was created as. */
  instruments: ReadonlyMap<string, InstrumentKind>;
  /** Exactly the refs this request asked for. */
  requested: ReadonlySet<string>;
  from?: IsoDate;
  to?: IsoDate;
  /** The run's clock, as an ISO date. Nothing may be dated after it. */
  now: IsoDate;
}

export interface RejectedPoint {
  index: number;
  reason: string;
}

export interface ValidationResult {
  accepted: FetchPoint[];
  rejected: RejectedPoint[];
  /** Refs whose response was ambiguous; their watermark must not advance. */
  ambiguousRefs: Set<string>;
}

/** True when a decimal string is strictly greater than zero. No floats. */
export function isPositiveDecimal(value: string): boolean {
  if (value.startsWith("-")) return false;
  return /[1-9]/.test(value);
}

/** Primary key of a point in `series_points` / `prices`. */
function keyOf(p: FetchPoint): string {
  return `${p.ref}|${p.date}|${p.tenorDays ?? 0}`;
}

export function validatePoints(points: readonly FetchPoint[], scope: ValidationScope): ValidationResult {
  const accepted: FetchPoint[] = [];
  const rejected: RejectedPoint[] = [];
  const ambiguousRefs = new Set<string>();
  const seen = new Set<string>();

  points.forEach((point, index) => {
    const reject = (reason: string, ambiguous = true) => {
      rejected.push({ index, reason });
      // `point.ref` may be junk; only blame a ref we can name.
      if (ambiguous && typeof point?.ref === "string") ambiguousRefs.add(point.ref);
    };

    const structural = FetchPointSchema.safeParse(point);
    if (!structural.success) return reject("malformed point");

    // A point for a ref nobody asked about makes the whole response ambiguous:
    // we cannot tell which requested ref it was meant to answer, or whether the
    // upstream simply answered a different question than the one we asked.
    //
    // Marking only the OFFENDING ref would be useless — the scheduler checks
    // ambiguity per REQUESTED ref, and the offender is by definition not in that
    // set, so a confidently "complete" window would still be recorded as
    // ingested on the strength of a response we could not attribute. Every
    // requested ref is therefore tainted.
    if (!scope.requested.has(point.ref)) {
      for (const requestedRef of scope.requested) ambiguousRefs.add(requestedRef);
      return reject("ref was not requested");
    }
    if (point.date > scope.now) return reject("date is in the future");
    if (scope.from !== undefined && point.date < scope.from) return reject("date is before the requested window");
    if (scope.to !== undefined && point.date > scope.to) return reject("date is after the requested window");

    const key = keyOf(point);
    if (seen.has(key)) return reject("duplicate primary key (ref, date, tenorDays)");

    const series = scope.series.get(point.ref);
    const instrument = scope.instruments.get(point.ref);
    if (!series && !instrument) return reject("ref matches no series or instrument");
    if (series && instrument) return reject("ref is ambiguous: both a series and an instrument");

    if (series) {
      const kind = series.kind;
      if (kind.kind === "yield_curve") {
        if (point.tenorDays === undefined) return reject("yield-curve point has no tenorDays");
        if (!kind.tenors.includes(point.tenorDays)) return reject("tenorDays is not a declared tenor");
        if (point.currency !== null) return reject("a yield-curve rate carries no currency");
      } else {
        if (point.tenorDays !== undefined) return reject("tenorDays is only valid for a yield-curve series");
        if (kind.kind === "fx_rate") {
          // The value is quote-currency units per one base unit, so the point's
          // currency must be the QUOTE currency.
          if (point.currency !== kind.quote) return reject("fx point currency does not match the declared quote currency");
          if (!isPositiveDecimal(point.value)) return reject("an fx rate must be positive");
        } else {
          if (point.currency !== null) return reject("a scalar series point carries no currency");
          // Rates may legitimately be zero or negative; levels may not.
          if ((kind.kind === "index_level" || kind.kind === "inflation_index") && !isPositiveDecimal(point.value)) {
            return reject("an index level must be positive");
          }
        }
      }
    } else if (instrument) {
      if (point.tenorDays !== undefined) return reject("tenorDays is only valid for a yield-curve series");
      if (point.currency !== instrument.quoteCurrency) {
        return reject("price currency does not match the instrument's quote currency");
      }
      if (!isPositiveDecimal(point.value)) return reject("a price must be positive");
    }

    seen.add(key);
    accepted.push(point);
  });

  return { accepted, rejected, ambiguousRefs };
}
