/**
 * Daily portfolio snapshot cron (SPEC §8) — the second of the two schedules
 * this project ships by design. Builds every user forward from their marker
 * within one per-invocation budget; a run that stops early is resumed by the
 * next trigger, so Vercel's lack of retries is not a correctness concern.
 *
 * RESPONSE DISCIPLINE (SPEC §12): status, counts, dates and reviewed error
 * codes only. Never a value.
 */
import { NextResponse } from "next/server";
import { PACKS } from "@/packs";
import { isCronAuthorized } from "@/lib/cron/auth";
import { CRON_MAX_DURATION_SECONDS, CRON_RESERVE_MS, ingestBudgetMs } from "@/lib/cron/budget";
import { runSnapshots } from "@/lib/jobs/snapshots";
import { createSnapshotStore } from "@/lib/jobs/snapshots-store";
import { createServiceRoleClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
// Keep in step with CRON_MAX_DURATION_SECONDS in lib/cron/budget.ts —
// budget.test.ts enforces it. Next.js requires a literal here.
export const maxDuration = 60;

export async function GET(req: Request) {
  // FIRST operation, before any database connection exists.
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const store = createSnapshotStore(createServiceRoleClient(), PACKS);
    const summary = await runSnapshots({
      scope: { kind: "all_users" },
      budgetMs: ingestBudgetMs(),
      reserveMs: CRON_RESERVE_MS,
      now: () => new Date(),
      store,
    });
    return NextResponse.json(
      {
        ok: summary.ok,
        durationMs: summary.durationMs,
        maxDurationSeconds: CRON_MAX_DURATION_SECONDS,
        users: summary.users.map((u) => ({
          status: u.status,
          from: u.from,
          to: u.to,
          daysBuilt: u.daysBuilt,
          rowsWritten: u.rowsWritten,
          errorCode: u.errorCode,
        })),
      },
      { status: 200 },
    );
  } catch {
    return NextResponse.json({ ok: false, errorCode: "scheduler_failed" }, { status: 500 });
  }
}
