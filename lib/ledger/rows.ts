/**
 * The one place the ledger is read for the kernel (docs/milestone-3-plan.md
 * "Reads"). Every numeric column leaves PostgREST as TEXT — `quantity::text`
 * — so no value ever passes through a JSON number, and every collection is
 * paginated and ordered by its key so pages cannot overlap or skip.
 *
 * Callers pass the user's own RLS-scoped client; nothing here filters by
 * user id because the database already has.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { IsoDate, MarketCalendar, MarketPack, SeriesDescriptor } from "@/packs/types";
import { addDays } from "@/lib/calc/dates";
import type { PortfolioInput } from "@/lib/calc/portfolio";
import {
  buildMarketData,
  type ExternalCashFlow,
  type HoldingAsset,
  type LedgerTransaction,
  type PriceObservation,
  type SeriesObservation,
  type TransactionType,
} from "@/lib/calc/types";
import { resolveActivation } from "@/lib/packs/activate";
import { readAll } from "@/lib/supabase/paginate";

// --- PostgREST row shapes, exactly as selected below -------------------------

export interface SettingsRow {
  base_currency: string;
  enabled_packs: string[] | null;
  locale: string;
  theme: "system" | "light" | "dark";
  last_export_at: string | null;
}
export interface AssetDbRow {
  id: string;
  pack_id: string;
  instrument_kind: string;
  identifier: string;
  name: string;
  native_currency: string;
  metadata: unknown;
}
export interface TransactionDbRow {
  id: string;
  asset_id: string;
  trade_date: string;
  type: TransactionType;
  quantity: string;
  unit_price: string;
  currency: string;
  fees: string;
  fx_rate: string | null;
}
export interface CashFlowDbRow {
  id: string;
  date: string;
  amount: string;
  currency: string;
}
export interface PriceDbRow {
  asset_id: string;
  date: string;
  price: string;
  currency: string;
  source_id: string;
}
export interface SeriesDbRow {
  series_id: string;
  date: string;
  value: string;
  tenor_days: number;
}

export const TRANSACTION_SELECT = "id,asset_id,trade_date,type,quantity::text,unit_price::text,currency,fees::text,fx_rate::text";
export const CASH_FLOW_SELECT = "id,date,amount::text,currency";
export const PRICE_SELECT = "asset_id,date,price::text,currency,source_id";
export const SERIES_SELECT = "series_id,date,value::text,tenor_days";
export const ASSET_SELECT = "id,pack_id,instrument_kind,identifier,name,native_currency,metadata";
export const SETTINGS_SELECT = "base_currency,enabled_packs,locale,theme,last_export_at";

// --- Row mappers: snake_case text rows → kernel input rows ---------------------

export const toTransaction = (r: TransactionDbRow): LedgerTransaction => ({
  id: r.id,
  assetId: r.asset_id,
  tradeDate: r.trade_date,
  type: r.type,
  quantity: r.quantity,
  unitPrice: r.unit_price,
  currency: r.currency,
  fees: r.fees,
  fxRate: r.fx_rate,
});
export const toCashFlow = (r: CashFlowDbRow): ExternalCashFlow => ({ id: r.id, date: r.date, amount: r.amount, currency: r.currency });
export const toPrice = (r: PriceDbRow): PriceObservation => ({ assetId: r.asset_id, date: r.date, price: r.price, currency: r.currency, sourceId: r.source_id });
export const toSeries = (r: SeriesDbRow): SeriesObservation => ({ seriesId: r.series_id, date: r.date, value: r.value, tenorDays: r.tenor_days });

/** An asset whose kind this build does not register: kept, shown as unpriced (decision 4). */
export interface UnresolvedAsset {
  id: string;
  packId: string;
  instrumentKind: string;
  identifier: string;
  name: string;
}

export function resolveAssets(rows: readonly AssetDbRow[], registry: readonly MarketPack[]): { assets: HoldingAsset[]; unresolved: UnresolvedAsset[] } {
  const assets: HoldingAsset[] = [];
  const unresolved: UnresolvedAsset[] = [];
  for (const r of rows) {
    const kind = registry.find((p) => p.id === r.pack_id)?.instruments.find((k) => k.id === r.instrument_kind);
    if (!kind) {
      unresolved.push({ id: r.id, packId: r.pack_id, instrumentKind: r.instrument_kind, identifier: r.identifier, name: r.name });
      continue;
    }
    assets.push({ id: r.id, packId: r.pack_id, instrumentKind: kind, identifier: r.identifier, nativeCurrency: r.native_currency, metadata: r.metadata });
  }
  return { assets, unresolved };
}

/** Two monthly inflation prints before the earliest lot, so `openedOn` levels are bracketed. */
export const SERIES_LOOKBACK_DAYS = 62;

export interface LedgerRead {
  settings: SettingsRow;
  assets: HoldingAsset[];
  unresolved: UnresolvedAsset[];
  transactions: LedgerTransaction[];
  cashFlows: ExternalCashFlow[];
  prices: PriceObservation[];
  series: SeriesObservation[];
  /** Enabled packs ∪ the packs of held assets, with dependencies. */
  packs: MarketPack[];
}

/** The user's settings row; defaults when the account has none yet. */
export async function readSettings(client: SupabaseClient, userId?: string): Promise<SettingsRow> {
  let q = client.from("user_settings").select(SETTINGS_SELECT);
  if (userId) q = q.eq("user_id", userId);
  const { data, error } = await q.maybeSingle();
  if (error) throw new Error(`ledger: settings (${error.code ?? "unknown"})`);
  // A bootstrapped account always has a row; a restored one may not yet.
  return (data as SettingsRow | null) ?? { base_currency: "BRL", enabled_packs: [], locale: "pt-BR", theme: "system", last_export_at: null };
}

export interface ReadLedgerOptions {
  /**
   * Only for a SERVICE-ROLE client, which RLS does not scope: every user
   * table is filtered by this id and prices by the user's asset ids. With
   * the user's own client the database already filters and this is not set.
   */
  userId?: string;
  /** Series are read from here on; nothing caps the end — ingestion never writes a future point. */
  seriesFrom?: IsoDate;
}

/** Prices have no user_id; under the service role they are read by the user's asset ids, in chunks. */
async function readPrices(client: SupabaseClient, assetIds: string[] | null): Promise<PriceObservation[]> {
  if (assetIds === null) {
    return (await readAll<PriceDbRow>((from, to) => client.from("prices").select(PRICE_SELECT).order("asset_id").order("date").range(from, to))).map(toPrice);
  }
  const out: PriceObservation[] = [];
  for (let i = 0; i < assetIds.length; i += 100) {
    const chunk = assetIds.slice(i, i + 100);
    const rows = await readAll<PriceDbRow>((from, to) => client.from("prices").select(PRICE_SELECT).in("asset_id", chunk).order("asset_id").order("date").range(from, to));
    out.push(...rows.map(toPrice));
  }
  return out;
}

/**
 * Everything the kernel needs about one user, as text rows. `seriesFrom`
 * narrows the series read; by default it is the earliest trade date less
 * the lookback, which is what a full valuation needs.
 */
export async function readLedger(client: SupabaseClient, registry: readonly MarketPack[], options: ReadLedgerOptions = {}): Promise<LedgerRead> {
  const { userId } = options;
  const settings = await readSettings(client, userId);
  const assetRows = await readAll<AssetDbRow>((from, to) => {
    const q = client.from("assets").select(ASSET_SELECT);
    return (userId ? q.eq("user_id", userId) : q).order("id").range(from, to);
  });
  const { assets, unresolved } = resolveAssets(assetRows, registry);
  const transactions = (
    await readAll<TransactionDbRow>((from, to) => {
      const q = client.from("transactions").select(TRANSACTION_SELECT);
      return (userId ? q.eq("user_id", userId) : q).order("trade_date").order("id").range(from, to);
    })
  ).map(toTransaction);
  const cashFlows = (
    await readAll<CashFlowDbRow>((from, to) => {
      const q = client.from("cash_flows").select(CASH_FLOW_SELECT);
      return (userId ? q.eq("user_id", userId) : q).order("date").order("id").range(from, to);
    })
  ).map(toCashFlow);
  const prices = await readPrices(client, userId ? assetRows.map((a) => a.id) : null);

  const packIds = new Set([...(settings.enabled_packs ?? []), ...assets.map((a) => a.packId)]);
  const packs = resolveActivation(registry, [...packIds]).packs;
  const seriesIds = packs.flatMap((p) => p.series.map((s) => s.id));
  const earliest = transactions.reduce<IsoDate | null>((min, t) => (min === null || t.tradeDate < min ? t.tradeDate : min), null);
  const seriesFrom = options.seriesFrom ?? (earliest === null ? null : addDays(earliest, -SERIES_LOOKBACK_DAYS));
  let series: SeriesObservation[] = [];
  if (seriesIds.length > 0 && seriesFrom !== null) {
    series = (
      await readAll<SeriesDbRow>((from, to) =>
        client.from("series_points").select(SERIES_SELECT).in("series_id", seriesIds).gte("date", seriesFrom).order("series_id").order("date").order("tenor_days").range(from, to),
      )
    ).map(toSeries);
  }

  return { settings, assets, unresolved, transactions, cashFlows, prices, series, packs };
}

/** The kernel's input, from a read. Calendars and series descriptors come from the packs in scope. */
export function toPortfolioInput(read: LedgerRead): PortfolioInput {
  const calendars = new Map<string, MarketCalendar>(read.packs.map((p) => [p.id, p.calendar]));
  const series: SeriesDescriptor[] = read.packs.flatMap((p) => p.series);
  return {
    baseCurrency: read.settings.base_currency,
    assets: read.assets,
    transactions: read.transactions,
    market: buildMarketData(read.prices, read.series),
    calendars,
    series,
  };
}
