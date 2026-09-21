/**
 * The backup file — version 1 (root SPEC §12.3; docs/milestone-2-plan.md
 * Phase 6; MILESTONES.md §2 decisions 3, 4, 18).
 *
 * A complete dump of ONE user's ledger: settings, assets, transactions, cash
 * flows and EVERY price row with its `source_id` (decision 3 — brapi's free
 * plan cannot backfill beyond three months, so ingested history lost from the
 * database is lost for good unless the backup carries it). Money is decimal
 * strings and dates ISO text, as at every boundary; `user_id` is never in the
 * file, because restore always writes the restoring user's own id (decision
 * 4). `series_points` and `portfolio_snapshots` are not user data and are not
 * here.
 *
 * Column names are the database's, so `export_backup()` and
 * `restore_backup(jsonb)` need no mapping layer.
 */
import { z } from "zod";
import { CurrencyCodeSchema, DecimalStringSchema, IsoDateSchema, PrefixedIdSchema } from "@/packs/schema";

export const BACKUP_VERSION = 1 as const;

const UuidSchema = z.uuid();
/** ISO 8601 UTC with microseconds, exactly as `export_backup()` formats it. */
const TimestampSchema = z.iso.datetime();
const PackIdSchema = z.string().regex(/^([a-z]{2}|global)$/);

/** Decision 18: `last_export_at` is not carried — the restoring account earns its own. */
export const BackupSettingsSchema = z.object({
  base_currency: CurrencyCodeSchema,
  enabled_packs: z.array(PackIdSchema),
  locale: z.string().min(1),
  theme: z.enum(["system", "light", "dark"]),
});

export const BackupAssetSchema = z.object({
  id: UuidSchema,
  pack_id: PackIdSchema,
  instrument_kind: PrefixedIdSchema,
  identifier: z.string().min(1),
  name: z.string().min(1),
  native_currency: CurrencyCodeSchema,
  metadata: z.record(z.string(), z.unknown()),
  created_at: TimestampSchema,
  updated_at: TimestampSchema,
});

export const BackupTransactionSchema = z.object({
  id: UuidSchema,
  asset_id: UuidSchema,
  trade_date: IsoDateSchema,
  type: z.enum(["buy", "sell", "dividend", "interest", "fee"]),
  quantity: DecimalStringSchema,
  unit_price: DecimalStringSchema,
  currency: CurrencyCodeSchema,
  fees: DecimalStringSchema,
  fx_rate: DecimalStringSchema.nullable(),
  note: z.string().nullable(),
  created_at: TimestampSchema,
});

export const BackupCashFlowSchema = z.object({
  id: UuidSchema,
  date: IsoDateSchema,
  amount: DecimalStringSchema,
  currency: CurrencyCodeSchema,
  note: z.string().nullable(),
  created_at: TimestampSchema,
});

export const BackupPriceSchema = z.object({
  asset_id: UuidSchema,
  date: IsoDateSchema,
  price: DecimalStringSchema,
  currency: CurrencyCodeSchema,
  source_id: z.string().min(1),
});

export const BackupSchema = z.object({
  version: z.literal(BACKUP_VERSION),
  exported_at: TimestampSchema,
  /** Null when the account had no settings row yet. */
  settings: BackupSettingsSchema.nullable(),
  assets: z.array(BackupAssetSchema),
  transactions: z.array(BackupTransactionSchema),
  cash_flows: z.array(BackupCashFlowSchema),
  prices: z.array(BackupPriceSchema),
});

export type Backup = z.infer<typeof BackupSchema>;
export type BackupAsset = z.infer<typeof BackupAssetSchema>;
export type BackupTransaction = z.infer<typeof BackupTransactionSchema>;
export type BackupCashFlow = z.infer<typeof BackupCashFlowSchema>;
export type BackupPrice = z.infer<typeof BackupPriceSchema>;

export type ParseBackupResult =
  | { ok: true; backup: Backup }
  /** Fixed reasons: a screen shows one line per reason, never zod prose. */
  | { ok: false; reason: "unsupported_version" | "invalid_backup"; issues: string[] };

/** The version is checked FIRST so a file from a future release gets its own reason. */
export function parseBackup(input: unknown): ParseBackupResult {
  const version = typeof input === "object" && input !== null ? (input as { version?: unknown }).version : undefined;
  if (version !== BACKUP_VERSION) {
    return {
      ok: false,
      reason: "unsupported_version",
      issues: [`version ${String(version)} is not ${BACKUP_VERSION}`],
    };
  }
  const parsed = BackupSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_backup",
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    };
  }
  return { ok: true, backup: parsed.data };
}
