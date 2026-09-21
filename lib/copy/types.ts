/**
 * Every string a person reads, as one typed shape (MILESTONES.md §4
 * decision 34). `en.ts` and `pt-BR.ts` each implement `Copy` in full, so a
 * key present in one dictionary and missing in the other is a type error —
 * and `copy.test.ts` proves the key sets are identical at runtime too.
 *
 * Groups fill in as screens are designed (Milestone 4 Phases 2–5). A leaf is
 * a string, or a function of named parameters when a count or a name is
 * interpolated; never a template a screen assembles from fragments, because
 * the two languages order their words differently.
 */
import type { SecurityReason } from "@/lib/auth/security";
import type { DatabaseRestoreRefusal, RestoreRefusal } from "@/lib/backup";
import type { CommitRefusal } from "@/lib/import/commit";
import type { ActionReason } from "@/lib/ledger/result";

/** The outcome codes the import page shows, beyond the commit planner's own. */
export type ImportOutcome = CommitRefusal | "no_file" | "too_large" | "write_failed" | "not_found" | "invalid_input";
/** The outcome codes Settings shows for a restore, beyond the planner's and the database's own. */
export type RestoreOutcome = RestoreRefusal | DatabaseRestoreRefusal | "done" | "no_file" | "write_failed";
export type DeleteOutcome = "phrase" | "password" | "failed";

export interface Copy {
  /** The one line under a saved form. */
  saved: string;
  /** "Check: a, b." after a field-level refusal. */
  checkFields: (p: { fields: string }) => string;
  /** One line per `ActionReason` (lib/ledger/result.ts). */
  reasons: Record<ActionReason, string>;
  /** One line per `SecurityReason`, plus the one-factor refusal. */
  security: Record<SecurityReason | "factor_exists", string>;
  restore: Record<RestoreOutcome, string> & {
    /** The warnings acknowledgement line: N items this build cannot price. */
    warnings: (p: { count: number; codes: string }) => string;
  };
  delete: Record<DeleteOutcome, string>;
  import: Record<ImportOutcome, string>;
}
