/**
 * The wall clock, for server components and actions that render "now" —
 * today's valuation, whether a Refresh press is still fresh. One module so
 * the reads are named and a test can see where time enters; the jobs take
 * `now` as a parameter instead and never read this.
 */
export function nowMs(): number {
  return Date.now();
}

/** Today's calendar date in UTC, "YYYY-MM-DD". */
export function todayIso(now = nowMs()): string {
  return new Date(now).toISOString().slice(0, 10);
}
