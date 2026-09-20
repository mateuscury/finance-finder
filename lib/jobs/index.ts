/**
 * After-response jobs (docs/milestone-3-plan.md "Keys and clients";
 * MILESTONES.md §3 decisions 29, 30). These are the ONLY places outside the
 * cron routes that construct the service-role client — lint enforces it —
 * and a server action may call them only with a scope it derived through
 * the user's own RLS client: the asset ids it just created, its own user
 * id. A runner never reads a form field.
 *
 * Every runner takes `spentMs`, the time the action already used, so the
 * chain fits the route's `maxDuration = 60` (decision 30). Summaries are
 * counts and codes, never values (SPEC §12).
 */
import { PACKS } from "@/packs";
import type { PriceSource } from "@/packs/types";
import { CRON_RESERVE_MS, ingestBudgetMs } from "@/lib/cron/budget";
import { createPackHttp } from "@/lib/packs/http";
import { runIngest, type IngestScope, type IngestSummary } from "@/lib/packs/ingest";
import { createIngestStore } from "@/lib/packs/store";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { runSnapshots, type SnapshotScope, type SnapshotSummary } from "./snapshots";
import { createSnapshotStore } from "./snapshots-store";

/** What is left of the route budget after `spentMs`; never below one reserve. */
export function remainingBudgetMs(spentMs: number): number {
  return Math.max(CRON_RESERVE_MS, ingestBudgetMs() - Math.max(0, spentMs));
}

export async function ingestJob(scope: IngestScope, spentMs = 0): Promise<IngestSummary> {
  const store = createIngestStore(createServiceRoleClient());
  return runIngest({
    scope,
    budgetMs: remainingBudgetMs(spentMs),
    reserveMs: CRON_RESERVE_MS,
    now: () => new Date(),
    store,
    registry: PACKS,
    env: process.env,
    httpFactory: (source: PriceSource, signal: AbortSignal, deadline: number) => createPackHttp({ source, mode: "live", signal, deadline, env: process.env }),
  });
}

export async function snapshotsJob(scope: SnapshotScope, spentMs = 0): Promise<SnapshotSummary> {
  const store = createSnapshotStore(createServiceRoleClient(), PACKS);
  return runSnapshots({ scope, budgetMs: remainingBudgetMs(spentMs), reserveMs: CRON_RESERVE_MS, now: () => new Date(), store });
}

/**
 * The chain an asset creation or a Refresh runs after the response
 * (decision 29): price, then value. The ingest's own budget accounting
 * leaves whatever it did not use to the snapshots.
 */
export async function priceThenSnapshot(ingest: IngestScope, userIds: string[], spentMs = 0): Promise<{ ingest: IngestSummary; snapshots: SnapshotSummary }> {
  const startedAt = Date.now();
  const ingestSummary = await ingestJob(ingest, spentMs);
  const snapshotsSummary = await snapshotsJob({ kind: "users", userIds }, spentMs + (Date.now() - startedAt));
  return { ingest: ingestSummary, snapshots: snapshotsSummary };
}

/**
 * SPEC §12.3 "Delete everything": the auth user row goes under the service
 * role and every user-scoped table cascades. The ONE deliberately
 * user-triggered service-role write. The action has already re-checked the
 * password and the typed phrase; this only deletes the id it is given.
 */
export async function deleteUserJob(userId: string): Promise<{ ok: boolean }> {
  const { error } = await createServiceRoleClient().auth.admin.deleteUser(userId);
  return { ok: error === null };
}
