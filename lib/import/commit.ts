/**
 * The commit planner (SPEC §9.1 "Commit is all-or-nothing"): from a fresh
 * dry run and the user's choices, the exact rows to insert — or a refusal.
 * The action then inserts them in ONE statement, so a constraint failure on
 * any row writes nothing.
 */
import type { DryRun, ImportRow } from "./dryRun";

export type CommitRefusal = "preview_changed" | "rows_have_errors" | "unresolved_identifiers" | "nothing_to_import";

export type CommitPlan =
  { ok: true; rows: ImportRow[]; skippedDuplicates: number; forced: number } | { ok: false; reason: CommitRefusal };

export function planCommit(run: DryRun, expectedHash: string, forceInclude: ReadonlySet<number>): CommitPlan {
  if (!run.ok) return { ok: false, reason: "rows_have_errors" };
  if (run.previewHash !== expectedHash) return { ok: false, reason: "preview_changed" };
  if (run.counts.errors > 0) return { ok: false, reason: "rows_have_errors" };
  if (run.counts.unresolved > 0) return { ok: false, reason: "unresolved_identifiers" };
  const rows: ImportRow[] = [];
  let skippedDuplicates = 0;
  let forced = 0;
  for (const row of run.rows) {
    if (row.parsed === null) return { ok: false, reason: "rows_have_errors" };
    if (row.duplicate) {
      if (!forceInclude.has(row.index)) {
        skippedDuplicates += 1;
        continue;
      }
      forced += 1;
    }
    rows.push(row.parsed);
  }
  if (rows.length === 0) return { ok: false, reason: "nothing_to_import" };
  return { ok: true, rows, skippedDuplicates, forced };
}
