/**
 * packs/coverage.ts — KERNEL-OWNED, like types.ts and schema.ts.
 *
 * Packs import this and never edit it. It builds the `RefCoverage[]` that a
 * bounded `FetchResult` must carry (plan §0.1). This is bookkeeping over dates
 * an adapter already produced, not valuation math, so it does not breach the
 * one rule (PACKS.md §1) — and keeping it here means five adapters cannot drift
 * into five subtly different definitions of "covered".
 */
import type { FetchPoint, IsoDate, RefCoverage } from "./types";

/**
 * Derive one coverage entry per requested ref from the points an adapter is
 * about to return.
 *
 * `complete(ref)` is the adapter's own judgement and cannot be inferred from
 * the points: an empty range from a source that answered authoritatively is
 * complete, while an empty range from a source that refused, truncated or was
 * cancelled is not. Getting that backwards is what would let the scheduler
 * mark an unfetched span as ingested, so the adapter must state it explicitly.
 */
export function coverageFor(
  refs: readonly string[],
  requested: { from: IsoDate; to: IsoDate },
  points: readonly FetchPoint[],
  complete: (ref: string) => boolean,
  /**
   * Optional: the source's structural lower availability boundary for this ref.
   * Supply it whenever the source KNOWS it cannot reach further back, even —
   * especially — when that means no points came back at all.
   */
  unavailableBefore?: (ref: string) => IsoDate | null,
): RefCoverage[] {
  return refs.map((ref) => {
    // ISO dates are lexicographically ordered, so string compare is date compare.
    let min: IsoDate | null = null;
    let max: IsoDate | null = null;
    for (const p of points) {
      if (p.ref !== ref) continue;
      if (min === null || p.date < min) min = p.date;
      if (max === null || p.date > max) max = p.date;
    }
    const floor = unavailableBefore?.(ref) ?? null;
    return {
      ref,
      requested: { from: requested.from, to: requested.to },
      returned: min !== null && max !== null ? { from: min, to: max } : null,
      complete: complete(ref),
      ...(floor !== null ? { unavailableBefore: floor } : {}),
    };
  });
}
