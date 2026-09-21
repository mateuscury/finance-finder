/**
 * Time series come from `portfolio_snapshots` (MILESTONES.md §4 decision
 * 36): the confident total per date from the `snapshot_totals` view, the
 * per-asset rows at a date, the first and last dates. Text-cast, paginated,
 * date-ranged, under the user's own RLS — like every other read in
 * `lib/ledger`. Period figures (TWR, MWR, contribution) are the kernel's,
 * computed from these plus the ledger at request time; nothing here is a
 * cache.
 */
import type { IsoDate } from "@/packs/types";
import { readAll } from "@/lib/supabase/paginate";
import type { Db } from "@/lib/supabase/types";

export interface SnapshotTotal {
  date: IsoDate;
  baseCurrency: string;
  /** Sum of `ok` + `carried_forward` rows, a decimal string. */
  totalBase: string;
  rows: number;
  staleRows: number;
  carriedRows: number;
}

interface TotalsViewRow {
  date: string;
  base_currency: string;
  total_base: string;
  rows: number;
  stale_rows: number;
  carried_rows: number;
}

/** Confident totals per date, ascending, optionally bounded to `[from, to]`. */
export async function readSnapshotTotals(
  client: Db,
  range: { from?: IsoDate; to?: IsoDate } = {},
): Promise<SnapshotTotal[]> {
  const rows = await readAll<TotalsViewRow>((from, to) => {
    let q = client.from("snapshot_totals").select("date,base_currency,total_base,rows,stale_rows,carried_rows");
    if (range.from) q = q.gte("date", range.from);
    if (range.to) q = q.lte("date", range.to);
    // A generated view type marks every column nullable; the view aggregates NOT NULL columns.
    return q.order("date").range(from, to).overrideTypes<TotalsViewRow[]>();
  });
  return rows.map((r) => ({
    date: r.date,
    baseCurrency: r.base_currency,
    totalBase: r.total_base,
    rows: r.rows,
    staleRows: r.stale_rows,
    carriedRows: r.carried_rows,
  }));
}

export interface SnapshotRange {
  first: IsoDate | null;
  last: IsoDate | null;
}

/** The span of the user's snapshots, from their marker row. */
export async function readSnapshotRange(client: Db): Promise<SnapshotRange> {
  const first = await client
    .from("portfolio_snapshots")
    .select("date")
    .order("date", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (first.error) throw new Error(`snapshots: first (${first.error.code ?? "unknown"})`);
  const last = await client
    .from("portfolio_snapshots")
    .select("date")
    .order("date", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (last.error) throw new Error(`snapshots: last (${last.error.code ?? "unknown"})`);
  return { first: first.data?.date ?? null, last: last.data?.date ?? null };
}

export interface SnapshotAssetRow {
  assetId: string;
  date: IsoDate;
  quantity: string;
  priceNative: string;
  priceDate: IsoDate | null;
  fxRate: string | null;
  fxDate: IsoDate | null;
  baseCurrency: string;
  marketValueBase: string;
  carriedForward: boolean;
  status: "ok" | "carried_forward" | "stale";
}

export const SNAPSHOT_SELECT =
  "asset_id,date,quantity::text,price_native::text,price_date,fx_rate::text,fx_date,base_currency,market_value_base::text,carried_forward,status";

interface SnapshotDbRow {
  asset_id: string;
  date: string;
  quantity: string;
  price_native: string;
  price_date: string | null;
  fx_rate: string | null;
  fx_date: string | null;
  base_currency: string;
  market_value_base: string;
  carried_forward: boolean;
  status: string;
}

const toRow = (r: SnapshotDbRow): SnapshotAssetRow => ({
  assetId: r.asset_id,
  date: r.date,
  quantity: r.quantity,
  priceNative: r.price_native,
  priceDate: r.price_date,
  fxRate: r.fx_rate,
  fxDate: r.fx_date,
  baseCurrency: r.base_currency,
  marketValueBase: r.market_value_base,
  carriedForward: r.carried_forward,
  status: r.status as SnapshotAssetRow["status"],
});

/** Every asset's row on one date, ordered by asset id. */
export async function readSnapshotRowsAt(client: Db, date: IsoDate): Promise<SnapshotAssetRow[]> {
  const rows = await readAll<SnapshotDbRow>((from, to) =>
    client
      .from("portfolio_snapshots")
      .select(SNAPSHOT_SELECT)
      .eq("date", date)
      .order("asset_id")
      .range(from, to)
      .overrideTypes<SnapshotDbRow[]>(),
  );
  return rows.map(toRow);
}

/** Every asset's rows in `[from, to]`, ordered by asset id then date. */
export async function readSnapshotRowsBetween(client: Db, from: IsoDate, to: IsoDate): Promise<SnapshotAssetRow[]> {
  const rows = await readAll<SnapshotDbRow>((f, t) =>
    client
      .from("portfolio_snapshots")
      .select(SNAPSHOT_SELECT)
      .gte("date", from)
      .lte("date", to)
      .order("asset_id")
      .order("date")
      .range(f, t)
      .overrideTypes<SnapshotDbRow[]>(),
  );
  return rows.map(toRow);
}
