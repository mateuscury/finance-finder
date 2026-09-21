/**
 * Everything the import page and the commit action share: the pending
 * upload, its parse, the saved column map, the user's assets and
 * transactions as text, and the dry run over all of it. Server-only.
 */
import type { Db } from "@/lib/supabase/types";
import type { MarketPack } from "@/packs/types";
import { parseCsv } from "@/lib/csv/parse";
import {
  dryRun,
  normalizeColumnMap,
  resolveColumns,
  type ColumnMap,
  type DryRun,
  type KnownAsset,
  type KnownTransaction,
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
  const [assets, existing] = await Promise.all([
    readAll<KnownAsset>((from, to) =>
      client.from("assets").select("id,pack_id,instrument_kind,identifier,native_currency").order("id").range(from, to),
    ),
    readAll<KnownTransaction>((from, to) =>
      client
        .from("transactions")
        .select("asset_id,trade_date,type,quantity::text,unit_price::text")
        .order("trade_date")
        .order("id")
        .range(from, to),
    ),
  ]);
  const run = dryRun(parsed.header, parsed.rows, map, assets, existing, registry);
  return {
    kind: "preview",
    filename,
    header: parsed.header,
    rowCount: parsed.rows.length,
    map,
    mapping: resolveColumns(parsed.header, map),
    run,
  };
}
