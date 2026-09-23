/**
 * The list and count reads the ledger pages need (docs/milestone-3-plan.md
 * "Reads"). Lists are one page each, ordered by key; counts are
 * `head: true`, never a row read.
 */
import type { Db, TableName, UserTable } from "@/lib/supabase/types";
import type { MarketPack } from "@/packs/types";
import { readAll } from "@/lib/supabase/paginate";
import type { TransactionFilter } from "./schemas";
import {
  ASSET_SELECT,
  CASH_FLOW_SELECT,
  TRANSACTION_SELECT,
  type AssetDbRow,
  type CashFlowDbRow,
  type TransactionDbRow,
} from "./rows";

export const LIST_PAGE_SIZE = 100;

export interface LatestPrice {
  date: string;
  price: string;
  currency: string;
  sourceId: string;
}

export interface AssetListItem extends AssetDbRow {
  /** The registered kind's label, or null when this build does not know the kind. */
  kindLabel: string | null;
  /** How the kind is valued, so the page can say "accrues" instead of "unpriced". */
  valuation: "market_price" | "nav_unit_price" | "accrual" | "curve_mark_to_market" | null;
  /** The source that prices this kind, for market and NAV kinds. */
  sourceId: string | null;
  latest: LatestPrice | null;
  /** `ingest_cursors.last_error` for that source, when unpriced (SPEC §9.4). */
  sourceError: string | null;
}

export async function listAssets(client: Db, registry: readonly MarketPack[]): Promise<AssetListItem[]> {
  const rows = await readAll<AssetDbRow>((from, to) =>
    client.from("assets").select(ASSET_SELECT).order("identifier").order("id").range(from, to),
  );
  if (rows.length === 0) return [];
  const latest = new Map<string, LatestPrice>();
  const ids = rows.map((r) => r.id);
  for (let i = 0; i < ids.length; i += LIST_PAGE_SIZE) {
    const chunk = ids.slice(i, i + LIST_PAGE_SIZE);
    const page = await readAll<{ asset_id: string; date: string; price: string; currency: string; source_id: string }>(
      (from, to) =>
        client
          .from("asset_latest_prices")
          .select("asset_id,date,price,currency,source_id")
          .in("asset_id", chunk)
          .order("asset_id")
          .range(from, to)
          // A generated view type marks every column nullable; this view selects
          // from NOT NULL columns of `prices`, so the rows are complete.
          .overrideTypes<{ asset_id: string; date: string; price: string; currency: string; source_id: string }[]>(),
    );
    for (const p of page)
      latest.set(p.asset_id, { date: p.date, price: p.price, currency: p.currency, sourceId: p.source_id });
  }
  const cursors = new Map<string, string | null>();
  const cursorRows = await readAll<{ source_id: string; last_error: string | null }>((from, to) =>
    client.from("ingest_cursors").select("source_id,last_error").order("source_id").range(from, to),
  );
  for (const c of cursorRows) cursors.set(c.source_id, c.last_error);

  return rows.map((r) => {
    const kind = registry.find((p) => p.id === r.pack_id)?.instruments.find((k) => k.id === r.instrument_kind) ?? null;
    const valuation = kind?.valuation.kind ?? null;
    const sourceId =
      kind && (kind.valuation.kind === "market_price" || kind.valuation.kind === "nav_unit_price")
        ? kind.valuation.sourceId
        : null;
    const price = latest.get(r.id) ?? null;
    return {
      ...r,
      kindLabel: kind?.label ?? null,
      valuation,
      sourceId,
      latest: price,
      sourceError: price === null && sourceId !== null ? (cursors.get(sourceId) ?? null) : null,
    };
  });
}

export interface Page<T> {
  rows: T[];
  page: number;
  pageSize: number;
  total: number;
}

/**
 * The subset of the PostgREST builder a list filter uses. Narrow on purpose:
 * a filter may only narrow rows, never change the select, the order or the
 * range, which `pageOf` owns.
 */
export type Filterable = {
  eq(column: string, value: unknown): Filterable;
  gte(column: string, value: unknown): Filterable;
  lte(column: string, value: unknown): Filterable;
};

async function pageOf<T>(
  client: Db,
  table: TableName,
  select: string,
  order: string[],
  page: number,
  /** Applied BEFORE `.order()` and `.range()`, so the database filters and counts, not the page. */
  apply?: (q: Filterable) => Filterable,
): Promise<Page<T>> {
  const from = (page - 1) * LIST_PAGE_SIZE;
  let q = client.from(table).select(select, { count: "exact" });
  if (apply) q = apply(q as never) as never;
  for (const col of order) q = q.order(col.replace(/^-/, ""), { ascending: !col.startsWith("-") });
  const { data, error, count } = await q.range(from, from + LIST_PAGE_SIZE - 1);
  if (error) throw new Error(`ledger: ${table} page (${error.code ?? "unknown"})`);
  return { rows: (data ?? []) as T[], page, pageSize: LIST_PAGE_SIZE, total: count ?? 0 };
}

export interface TransactionListItem extends TransactionDbRow {
  identifier: string;
  assetName: string;
}

/**
 * One page of the ledger, narrowed by the list's filter (decision 64). The
 * filter is applied by the database, so `count` is the FILTERED count and a
 * user with years of history pages through what they asked for.
 */
export async function listTransactions(
  client: Db,
  page = 1,
  filter: TransactionFilter = {},
): Promise<Page<TransactionListItem>> {
  const result = await pageOf<
    TransactionDbRow & { assets: { identifier: string; name: string } | { identifier: string; name: string }[] | null }
  >(client, "transactions", `${TRANSACTION_SELECT},assets!inner(identifier,name)`, ["-trade_date", "id"], page, (q) => {
    let out = q;
    if (filter.asset) out = out.eq("asset_id", filter.asset);
    if (filter.type) out = out.eq("type", filter.type);
    if (filter.from) out = out.gte("trade_date", filter.from);
    if (filter.to) out = out.lte("trade_date", filter.to);
    return out;
  });
  return {
    ...result,
    rows: result.rows.map((r) => {
      // PostgREST embeds a to-one row as an object or a one-element array.
      const asset = Array.isArray(r.assets) ? r.assets[0] : r.assets;
      const row: TransactionDbRow = {
        id: r.id,
        asset_id: r.asset_id,
        trade_date: r.trade_date,
        type: r.type,
        quantity: r.quantity,
        unit_price: r.unit_price,
        currency: r.currency,
        fees: r.fees,
        fx_rate: r.fx_rate,
      };
      return { ...row, identifier: asset?.identifier ?? "?", assetName: asset?.name ?? "?" };
    }),
  };
}

export function listCashFlows(client: Db, page = 1): Promise<Page<CashFlowDbRow & { note: string | null }>> {
  return pageOf(client, "cash_flows", `${CASH_FLOW_SELECT},note`, ["-date", "id"], page);
}

export interface LedgerCounts {
  assets: number;
  transactions: number;
  cashFlows: number;
}

export async function countLedger(client: Db): Promise<LedgerCounts> {
  const count = async (table: UserTable): Promise<number> => {
    const { count: n, error } = await client.from(table).select("*", { count: "exact", head: true });
    if (error) throw new Error(`ledger: count ${table} (${error.code ?? "unknown"})`);
    return n ?? 0;
  };
  const [assets, transactions, cashFlows] = await Promise.all([
    count("assets"),
    count("transactions"),
    count("cash_flows"),
  ]);
  return { assets, transactions, cashFlows };
}
