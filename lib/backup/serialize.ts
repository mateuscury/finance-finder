/**
 * Deterministic backup text (docs/milestone-2-plan.md Phase 6): rows in a
 * stable order, keys in a fixed order, decimals canonical. Two exports of the
 * same data are byte-identical except `exported_at`, so a diff between two
 * backups is a diff between two ledgers.
 */
import { parseDecimal, toDecimalString } from "@/lib/calc/decimal";
import type { Backup, BackupAsset, BackupCashFlow, BackupPrice, BackupTransaction } from "./schema";

const canonical = (d: string): string => toDecimalString(parseDecimal(d));
const optional = (d: string | null): string | null => (d === null ? null : canonical(d));
const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function asset(a: BackupAsset): BackupAsset {
  return {
    id: a.id,
    pack_id: a.pack_id,
    instrument_kind: a.instrument_kind,
    identifier: a.identifier,
    name: a.name,
    native_currency: a.native_currency,
    metadata: a.metadata,
    created_at: a.created_at,
    updated_at: a.updated_at,
  };
}

function transaction(t: BackupTransaction): BackupTransaction {
  return {
    id: t.id,
    asset_id: t.asset_id,
    trade_date: t.trade_date,
    type: t.type,
    quantity: canonical(t.quantity),
    unit_price: canonical(t.unit_price),
    currency: t.currency,
    fees: canonical(t.fees),
    fx_rate: optional(t.fx_rate),
    note: t.note,
    created_at: t.created_at,
  };
}

function cashFlow(f: BackupCashFlow): BackupCashFlow {
  return { id: f.id, date: f.date, amount: canonical(f.amount), currency: f.currency, note: f.note, created_at: f.created_at };
}

function price(p: BackupPrice): BackupPrice {
  return { asset_id: p.asset_id, date: p.date, price: canonical(p.price), currency: p.currency, source_id: p.source_id };
}

/** The same ledger in canonical form: sorted rows, fixed key order, canonical decimals. */
export function canonicalBackup(b: Backup): Backup {
  return {
    version: b.version,
    exported_at: b.exported_at,
    settings:
      b.settings === null
        ? null
        : { base_currency: b.settings.base_currency, enabled_packs: [...b.settings.enabled_packs], locale: b.settings.locale, theme: b.settings.theme },
    assets: b.assets.map(asset).sort((x, y) => byText(x.id, y.id)),
    transactions: b.transactions.map(transaction).sort((x, y) => byText(x.trade_date, y.trade_date) || byText(x.id, y.id)),
    cash_flows: b.cash_flows.map(cashFlow).sort((x, y) => byText(x.date, y.date) || byText(x.id, y.id)),
    prices: b.prices.map(price).sort((x, y) => byText(x.asset_id, y.asset_id) || byText(x.date, y.date)),
  };
}

export function serializeBackup(b: Backup): string {
  return `${JSON.stringify(canonicalBackup(b), null, 2)}\n`;
}
