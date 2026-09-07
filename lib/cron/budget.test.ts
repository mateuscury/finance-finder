import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CRON_MAX_DURATION_SECONDS, CRON_RESERVE_MS, ingestBudgetMs } from "./budget";

describe("cron budget", () => {
  it("reserves time for the commit rather than spending the whole invocation fetching", () => {
    expect(ingestBudgetMs()).toBe(CRON_MAX_DURATION_SECONDS * 1000 - CRON_RESERVE_MS);
    expect(CRON_RESERVE_MS).toBeGreaterThanOrEqual(10_000);
    expect(ingestBudgetMs()).toBeGreaterThan(0);
  });

  it("stays within the duration Vercel allows without Fluid compute", () => {
    // Raising this past 60 requires confirming Fluid compute on the deployed
    // project; see the note in budget.ts.
    expect(CRON_MAX_DURATION_SECONDS).toBeLessThanOrEqual(300);
  });

  it("matches the maxDuration literal the price route actually exports", () => {
    // Next.js route segment config must be a literal, so the route cannot
    // import CRON_MAX_DURATION_SECONDS. This guard is what keeps them in sync.
    const route = fs.readFileSync(
      path.resolve(__dirname, "../../app/api/cron/prices/route.ts"),
      "utf8",
    );
    const m = /export const maxDuration = (\d+)/.exec(route);
    expect(m, "app/api/cron/prices/route.ts must export a literal maxDuration").not.toBeNull();
    expect(Number(m![1])).toBe(CRON_MAX_DURATION_SECONDS);
  });
});
