/**
 * Everything the import page and the commit action share: the pending
 * upload, its parse, the saved column map, the user's assets and
 * transactions as text, and the dry run over all of it. Server-only.
 */
import type { Db } from "@/lib/supabase/types";
import type { MarketPack } from "@/packs/types";
import { parseCsv } from "@/lib/csv/parse";
import { IsoDateSchema } from "@/packs/schema";
import {
  dryRun,
  normalizeColumnMap,
  resolveColumns,
  type ColumnMap,
  type DryRun,
  type KnownAsset,
  type KnownTransaction,
  type MappingResult,
} from "@/lib/import";
import { readSettings } from "@/lib/ledger/rows";
import { readAll } from "@/lib/supabase/paginate";

export type LoadedImport =
  | { kind: "none" }
  | { kind: "unparsable"; filename: string; reason: string; line: number }
  | {
      kind: "preview";
      filename: string;
      header: string[];
      rowCount: number;
      map: ColumnMap;
      mapping: ReturnType<typeof resolveColumns>;
      run: DryRun;
    };

export async function loadDryRun(client: Db, registry: readonly MarketPack[]): Promise<LoadedImport> {
  const pending = await client.from("csv_imports").select("filename,content").maybeSingle();
  if (pending.error || !pending.data) return { kind: "none" };
  const { filename, content } = pending.data;
  const parsed = parseCsv(content);
  if (!parsed.ok) return { kind: "unparsable", filename, reason: parsed.reason, line: parsed.line };

  const settings = await readSettings(client);
  const map = normalizeColumnMap(settings.csv_column_map);
  const mapping = resolveColumns(parsed.header, map);
  // Duplicate detection only needs the ledger's rows inside the file's own
  // date range (Milestone 4 D-14): a row can only duplicate a transaction on
  // its own trade date. Rows whose date does not parse are left out of the
  // bound; the dry run flags them as errors regardless.
  const bound = tradeDateBound(parsed.rows, mapping);
  const [assets, existing] = await Promise.all([
    readAll<KnownAsset>((from, to) =>
      client.from("assets").select("id,pack_id,instrument_kind,identifier,native_currency").order("id").range(from, to),
    ),
    bound === null
      ? Promise.resolve([] as KnownTransaction[])
      : readAll<KnownTransaction>((from, to) =>
          client
            .from("transactions")
            .select("asset_id,trade_date,type,quantity::text,unit_price::text")
            .gte("trade_date", bound.min)
            .lte("trade_date", bound.max)
            .order("trade_date")
            .order("id")
            .range(from, to),
        ),
  ]);
  const run = dryRun(parsed.header, parsed.rows, map, assets, existing, registry);
  return { kind: "preview", filename, header: parsed.header, rowCount: parsed.rows.length, map, mapping, run };
}

/** `[min, max]` of the rows' date column over the rows whose date parses; null when none does. */
export function tradeDateBound(rows: readonly string[][], mapping: MappingResult): { min: string; max: string } | null {
  if (!mapping.ok) return null;
  const index = mapping.indexOf.date;
  if (index === null) return null;
  let min: string | null = null;
  let max: string | null = null;
  for (const row of rows) {
    const value = row[index]?.trim();
    if (!value || !IsoDateSchema.safeParse(value).success) continue;
    if (min === null || value < min) min = value;
    if (max === null || value > max) max = value;
  }
  return min === null || max === null ? null : { min, max };
}
