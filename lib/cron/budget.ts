/**
 * The recorded deployment budget for the ingestion cron (plan §0.3).
 *
 * Vercel's current function-duration limits are up to 300s WITH Fluid compute
 * and 60s without it. This repository has no linked Vercel project
 * (`.vercel/project.json` is absent), so the deployed compute mode could not be
 * confirmed while this was written. The plan forbids inferring a budget, so the
 * value below is the one that is valid under BOTH modes.
 *
 * TO RAISE IT: confirm Fluid compute is enabled on the deployed project, then
 * change BOTH constants here and the `maxDuration` literal in
 * app/api/cron/prices/route.ts. `budget.test.ts` fails if the two disagree —
 * Next.js needs a statically analyzable literal in the route, so it cannot
 * import this value.
 */
export const CRON_MAX_DURATION_SECONDS = 60;

/**
 * Held back from the ingest budget for the final transactional commit and the
 * response. Ingestion stops scheduling new source work once only this much
 * remains, so a run always gets to persist what it already fetched. The plan
 * requires at least 10 seconds.
 */
export const CRON_RESERVE_MS = 10_000;

/** What `runIngest` is allowed to spend fetching and validating. */
export function ingestBudgetMs(
  maxDurationSeconds = CRON_MAX_DURATION_SECONDS,
  reserveMs = CRON_RESERVE_MS,
): number {
  return maxDurationSeconds * 1000 - reserveMs;
}
