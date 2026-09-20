/**
 * The restore planner — everything about a backup file that can be decided
 * WITHOUT the database (docs/milestone-2-plan.md Phase 6; MILESTONES.md §2
 * decisions 4 and 11).
 *
 * `restore_backup(jsonb)` is the trust boundary and re-checks what matters
 * inside its own transaction: the account is empty, no asset id is already
 * taken, every transaction and price names an asset in the restored set, and
 * every row is written under `auth.uid()`. The planner runs the same
 * file-local checks first so a screen can refuse with the same fixed reason
 * before a round trip, and it collects the WARNINGS the database does not
 * know about: an asset whose pack or instrument kind this build does not
 * register, or whose metadata fails the pack's schema. Those restore anyway
 * (the asset shows as unpriced) — data preservation beats validation in a
 * recovery path.
 */
import type { MarketPack } from "@/packs/types";
import { parseBackup, type Backup } from "./schema";
import { canonicalBackup } from "./serialize";

/**
 * The refusals the planner can decide from the file alone. `restore_backup`
 * additionally raises `not_authenticated`, `account_not_empty` and
 * `asset_id_conflict` (root SPEC §12.3), which need the database.
 */
export type RestoreRefusal = "unsupported_version" | "invalid_backup" | "duplicate_asset_id" | "foreign_asset_reference";

export interface RestoreWarning {
  assetId: string;
  code: "unknown_pack" | "unknown_instrument_kind" | "invalid_metadata";
}

export type RestorePlan =
  | { ok: true; payload: Backup; warnings: RestoreWarning[] }
  | { ok: false; reason: RestoreRefusal; issues: string[] };

export function planRestore(input: unknown, packs: readonly MarketPack[]): RestorePlan {
  const parsed = parseBackup(input);
  if (!parsed.ok) return { ok: false, reason: parsed.reason, issues: parsed.issues };
  const backup = canonicalBackup(parsed.backup);

  const ids = new Set<string>();
  for (const a of backup.assets) {
    if (ids.has(a.id)) return { ok: false, reason: "duplicate_asset_id", issues: [a.id] };
    ids.add(a.id);
  }
  const foreign = [
    ...backup.transactions.filter((t) => !ids.has(t.asset_id)).map((t) => `transaction ${t.id} → ${t.asset_id}`),
    ...backup.prices.filter((p) => !ids.has(p.asset_id)).map((p) => `price ${p.asset_id}/${p.date}`),
  ];
  if (foreign.length > 0) return { ok: false, reason: "foreign_asset_reference", issues: foreign };

  const warnings: RestoreWarning[] = [];
  for (const a of backup.assets) {
    const pack = packs.find((p) => p.id === a.pack_id);
    if (!pack) {
      warnings.push({ assetId: a.id, code: "unknown_pack" });
      continue;
    }
    const kind = pack.instruments.find((k) => k.id === a.instrument_kind);
    if (!kind) {
      warnings.push({ assetId: a.id, code: "unknown_instrument_kind" });
      continue;
    }
    if (!kind.metadataSchema.safeParse(a.metadata).success) warnings.push({ assetId: a.id, code: "invalid_metadata" });
  }
  return { ok: true, payload: backup, warnings };
}
