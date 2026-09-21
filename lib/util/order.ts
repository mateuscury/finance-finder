/**
 * Comparators shared by the two schedulers (docs/milestone-4-plan.md D-10).
 * Both order "least recently done first": a source or a user that keeps
 * failing or has never run must not starve behind one that always succeeds.
 */

/**
 * Nulls first, then the key ascending as strings, then `then` as the
 * tiebreak (which must itself be total, e.g. by id).
 */
export function nullsFirst<T>(key: (item: T) => string | null, then: (a: T, b: T) => number): (a: T, b: T) => number {
  return (a, b) => {
    const ka = key(a);
    const kb = key(b);
    if (ka === null && kb !== null) return -1;
    if (kb === null && ka !== null) return 1;
    if (ka !== null && kb !== null && ka !== kb) return ka < kb ? -1 : 1;
    return then(a, b);
  };
}

/** A total order on strings, for tiebreaks by id. */
export function byString<T>(key: (item: T) => string): (a: T, b: T) => number {
  return (a, b) => {
    const ka = key(a);
    const kb = key(b);
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  };
}
