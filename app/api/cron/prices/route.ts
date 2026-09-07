/**
 * Price + series ingestion cron (PACKS.md §10, plan §3.4).
 *
 * ONE invocation iterates every enabled pack's sources with a per-source time
 * budget and per-ref resume markers, rather than one job per pack. That is a
 * deliberate atomicity, rate-limit and resume design, NOT a platform cap:
 * Vercel currently allows a Hobby project up to 100 cron entries, each at most
 * once per day. This project intentionally ships exactly two schedules.
 *
 * Resumability lives in `ingest_watermarks`, not in the response code, because
 * Vercel does not retry a failed cron invocation.
 *
 * RESPONSE DISCIPLINE (SPEC §12): status, counts, durations and reviewed error
 * CODES only. Never a URL, ref, env value, warning string, response body,
 * point, quantity or price.
 */
import { NextResponse } from "next/server";
import { isCronAuthorized } from "@/lib/cron/auth";
import { CRON_MAX_DURATION_SECONDS, CRON_RESERVE_MS, ingestBudgetMs } from "@/lib/cron/budget";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createIngestStore } from "@/lib/packs/store";
import { createPackHttp } from "@/lib/packs/http";
import { runIngest } from "@/lib/packs/ingest";
import { PACKS } from "@/packs";
import type { PriceSource } from "@/packs/types";

export const dynamic = "force-dynamic";
// Recorded deployment budget (plan §0.3). Keep in step with
// CRON_MAX_DURATION_SECONDS in lib/cron/budget.ts — budget.test.ts enforces it.
// Next.js requires a statically analyzable literal here, so it cannot be imported.
export const maxDuration = 60;

export async function GET(req: Request) {
  // FIRST operation, before any database connection or network work exists.
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // Constructed only after authorization passes: an unauthorized request must
    // not cause the service-role key to be read or a connection to be opened.
    const store = createIngestStore(createServiceRoleClient());

    const summary = await runIngest({
      scope: { kind: "all_enabled" },
      budgetMs: ingestBudgetMs(),
      reserveMs: CRON_RESERVE_MS,
      now: () => new Date(),
      store,
      registry: PACKS,
      env: process.env,
      httpFactory: (source: PriceSource, signal: AbortSignal, deadline: number) =>
        createPackHttp({ source, mode: "live", signal, deadline, env: process.env }),
    });

    // A run that completed with per-source failures is still a completed run:
    // 200 with ok:false. 500 is reserved for a fatal scheduler or configuration
    // failure, so alerting can tell the two apart.
    return NextResponse.json(
      {
        ok: summary.ok,
        durationMs: summary.durationMs,
        maxDurationSeconds: CRON_MAX_DURATION_SECONDS,
        activatedPacks: summary.activatedPacks,
        activationWarnings: summary.activationWarnings,
        sources: summary.sources.map((s) => ({
          sourceId: s.sourceId,
          status: s.status,
          statusCodes: s.statusCodes,
          attempts: s.attempts,
          durationMs: s.durationMs,
          accepted: s.accepted,
          rejected: s.rejected,
          written: s.written,
          manualProtected: s.manualProtected,
          warnings: s.warnings,
          errorCode: s.errorCode,
        })),
      },
      { status: 200 },
    );
  } catch {
    // The caught error may embed a connection string or a key; nothing from it
    // is echoed. The code is a fixed, reviewed literal.
    return NextResponse.json({ ok: false, errorCode: "scheduler_failed" }, { status: 500 });
  }
}
