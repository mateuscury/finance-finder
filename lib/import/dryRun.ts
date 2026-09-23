/**
 * The dry run (SPEC §9.1): parses and validates every row, resolves assets,
 * flags duplicates, and writes nothing. Pure over rows the action fetched,
 * so the whole preview is unit-tested without a database.
 *
 * A row duplicates an existing transaction when
 * `(asset_id, trade_date, type, quantity, unit_price)` matches — compared
 * as canonical decimals, so "100" and "100.0000000000" are the same row.
 * Re-importing the same file is therefore all duplicates and a no-op.
 */
import { createHash } from "node:crypto";
import type { MarketPack } from "@/packs/types";
import { isDecimalString, parseDecimal, toDecimalString } from "@/lib/calc/decimal";
import { normalizeIdentifier } from "@/lib/ledger/assets";
import { failedFields, TransactionInputSchema } from "@/lib/ledger/schemas";
import { isKernelError } from "@/lib/calc/errors";
import { lotsAt } from "@/lib/calc/positions";
import type { LedgerTransaction } from "@/lib/calc/types";
import { resolveColumns, type CanonicalColumn, type ColumnMap } from "./mapping";

/** An existing asset, as the action reads it: identity → id. */
export interface KnownAsset {
  id: string;
  pack_id: string;
  instrument_kind: string;
  identifier: string;
  native_currency: string;
}

/** An existing transaction's duplicate key fields, as text from the database. */
export interface KnownTransaction {
  asset_id: string;
  trade_date: string;
  type: string;
  quantity: string;
  unit_price: string;
}

export interface PreviewRow {
  /** 0-based index into the data rows (header excluded). */
  index: number;
  values: Record<CanonicalColumn, string>;
  /** Canonical-column names that failed validation. */
  errors: string[];
  /** The resolved asset, or null when the identity is not among the user's assets. */
  assetId: string | null;
  duplicate: boolean;
  /**
   * This row would make its asset sell more than it ever bought, counting the
   * existing ledger and the rest of the file (SPEC §6, §9.1; decision 58).
   * `errors` also carries "quantity", so every existing gate already refuses.
   */
  oversell: boolean;
  /** The row as the ledger schema parsed it, when valid and resolved. */
  parsed: ImportRow | null;
}

/** A transaction ready to insert; `user_id` is added by the action. */
export interface ImportRow {
  asset_id: string;
  trade_date: string;
  type: "buy" | "sell" | "dividend" | "interest" | "fee";
  quantity: string;
  unit_price: string;
  currency: string;
  fees: string;
  note: string | null;
}

export interface UnresolvedIdentity {
  pack_id: string;
  instrument_kind: string;
  identifier: string;
  /** Data-row indexes that name it. */
  rows: number[];
  /** Whether this build registers the kind (an unregistered kind cannot be created from the preview). */
  registered: boolean;
}

export type DryRun =
  | { ok: false; reason: "missing_columns"; missing: CanonicalColumn[] }
  | {
      ok: true;
      rows: PreviewRow[];
      unresolved: UnresolvedIdentity[];
      /** Fingerprint of the parsed rows; commit refuses when it differs. */
      previewHash: string;
      counts: { total: number; valid: number; errors: number; unresolved: number; duplicates: number };
    };

const canon = (s: string) => (isDecimalString(s) ? toDecimalString(parseDecimal(s)) : s);
const duplicateKey = (t: KnownTransaction): string =>
  `${t.asset_id}|${t.trade_date}|${t.type}|${canon(t.quantity)}|${canon(t.unit_price)}`;

export function dryRun(
  header: readonly string[],
  dataRows: readonly (readonly string[])[],
  map: ColumnMap,
  assets: readonly KnownAsset[],
  existing: readonly KnownTransaction[],
  registry: readonly MarketPack[],
): DryRun {
  const columns = resolveColumns(header, map);
  if (!columns.ok) return { ok: false, reason: "missing_columns", missing: columns.missing };

  const assetByIdentity = new Map(assets.map((a) => [`${a.pack_id}|${a.instrument_kind}|${a.identifier}`, a] as const));
  const seen = new Set(existing.map(duplicateKey));
  const unresolved = new Map<string, UnresolvedIdentity>();
  const rows: PreviewRow[] = [];

  dataRows.forEach((raw, index) => {
    const values = {} as Record<CanonicalColumn, string>;
    for (const col of Object.keys(columns.indexOf) as CanonicalColumn[]) {
      const idx = columns.indexOf[col];
      values[col] = idx === null ? "" : (raw[idx] ?? "").trim();
    }
    // Resolve the asset by identity, normalising the identifier the way asset creation does.
    const kind = registry.find((p) => p.id === values.pack)?.instruments.find((k) => k.id === values.instrument_kind);
    const identifier = kind
      ? (normalizeIdentifier(kind.identifier, values.identifier) ?? values.identifier)
      : values.identifier;
    const asset = assetByIdentity.get(`${values.pack}|${values.instrument_kind}|${identifier}`) ?? null;

    // An unresolved row is still validated field by field, so the preview can
    // show "unresolved" AND "quantity must be positive" at once; a well-formed
    // stand-in id keeps the schema's uuid check out of the way until the
    // asset exists.
    const parsed = TransactionInputSchema.safeParse({
      asset_id: asset?.id ?? "00000000-0000-4000-8000-000000000000",
      trade_date: values.date,
      type: values.type,
      quantity: values.quantity,
      unit_price: values.unit_price,
      currency: values.currency,
      fees: values.fees === "" ? "0" : values.fees,
      note: values.note === "" ? null : values.note,
    });
    const errors = parsed.success ? [] : failedFields(parsed.error).map((f) => (f === "trade_date" ? "date" : f));
    if (!asset) {
      const key = `${values.pack}|${values.instrument_kind}|${identifier}`;
      const entry = unresolved.get(key) ?? {
        pack_id: values.pack,
        instrument_kind: values.instrument_kind,
        identifier,
        rows: [],
        registered: kind !== undefined,
      };
      entry.rows.push(index);
      unresolved.set(key, entry);
    }
    const row: PreviewRow = {
      index,
      values,
      errors,
      assetId: asset?.id ?? null,
      duplicate: false,
      oversell: false,
      parsed: null,
    };
    if (parsed.success && asset) {
      row.parsed = { ...parsed.data, asset_id: asset.id };
      const key = duplicateKey(row.parsed);
      // A repeat inside the file itself is a duplicate too.
      row.duplicate = seen.has(key);
      seen.add(key);
    }
    rows.push(row);
  });

  markOversells(rows, existing);

  const previewHash = createHash("sha256")
    .update(JSON.stringify(rows.map((r) => r.values)))
    .digest("hex");
  return {
    ok: true,
    rows,
    unresolved: [...unresolved.values()],
    previewHash,
    counts: {
      total: rows.length,
      valid: rows.filter((r) => r.errors.length === 0 && r.assetId !== null).length,
      errors: rows.filter((r) => r.errors.length > 0).length,
      unresolved: rows.filter((r) => r.assetId === null).length,
      duplicates: rows.filter((r) => r.duplicate).length,
    },
  };
}

/**
 * Marks every row whose sell the ledger cannot cover (SPEC §9.1, §6).
 *
 * Checked over the EXISTING rows plus the whole file, per asset, in trade-date
 * order — so a buy further down the file still covers a sell above it when the
 * buy is the earlier trade, and only a sell genuinely exceeding the position on
 * its date is marked. `lotsAt` names the offending transaction, which is how
 * the row is found rather than guessed.
 *
 * Duplicates are excluded because the default commit skips them; they are by
 * definition already counted in `existing`.
 */
function markOversells(rows: PreviewRow[], existing: readonly KnownTransaction[]): void {
  const planned = rows.filter((r) => r.parsed !== null && !r.duplicate && r.errors.length === 0);
  if (planned.length === 0) return;
  const assetIds = new Set(planned.map((r) => r.parsed!.asset_id));
  const byRowId = new Map<string, PreviewRow>(planned.map((r) => [`row:${r.index}`, r]));

  for (const assetId of assetIds) {
    const ledger: LedgerTransaction[] = [
      ...existing
        .filter((t) => t.asset_id === assetId)
        .map((t, i) => ({
          id: `db:${String(i).padStart(9, "0")}`,
          assetId,
          tradeDate: t.trade_date,
          type: t.type as LedgerTransaction["type"],
          quantity: t.quantity,
          unitPrice: t.unit_price,
          currency: "XXX",
          fees: "0",
          fxRate: null,
        })),
      ...planned
        .filter((r) => r.parsed!.asset_id === assetId)
        .map((r) => ({
          id: `row:${r.index}`,
          assetId,
          tradeDate: r.parsed!.trade_date,
          type: r.parsed!.type,
          quantity: r.parsed!.quantity,
          unitPrice: r.parsed!.unit_price,
          currency: "XXX",
          fees: "0",
          fxRate: null,
        })),
    ];
    // One asset at a time, and one offender at a time: mark it, drop it, and
    // look again, so a file with several bad sells names them all.
    for (;;) {
      try {
        lotsAt(ledger, "9999-12-31");
        break;
      } catch (err) {
        if (!isKernelError(err, "oversell")) throw err;
        const culprit = String((err.details as Record<string, unknown>).transactionId ?? "");
        const row = byRowId.get(culprit);
        const at = ledger.findIndex((t) => t.id === culprit);
        if (at === -1) break;
        ledger.splice(at, 1);
        // An existing row can be the one that tips over only because the file
        // added a sell before it; the file's own rows are what we can mark.
        if (!row) continue;
        row.oversell = true;
        if (!row.errors.includes("quantity")) row.errors.push("quantity");
        row.parsed = null;
      }
    }
  }
}
