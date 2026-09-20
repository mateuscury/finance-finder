/**
 * The snapshot job (SPEC §8; docs/milestone-3-plan.md "The snapshot job";
 * MILESTONES.md §3 decisions 20–22). ONE entry point, `runSnapshots`, shaped
 * like `runIngest`: a narrow store so the algorithm is unit-tested with a
 * fake, and one Supabase-backed implementation in `snapshots-store.ts`.
 *
 * Per user, the marker is the data itself — `max(snapshot date) + 1`, or
 * the earliest trade date when nothing exists; no cursor table. The job
 * builds one day at a time over the union of the user's holdable packs'
 * business days (decision 21), each day one atomic upsert of exactly the
 * rows `valuePortfolio` produced (decision 17) plus the columns decision 22
 * added, and stops cleanly when the budget is spent so the next trigger
 * resumes. The decision 20 triggers make a history-changing write drop the
 * rows from its date forward, which moves the marker back by itself.
 */
import type { IsoDate, MarketCalendar } from "@/packs/types";
import { isBusinessDay } from "@/lib/calc/calendar";
import { toDecimalString } from "@/lib/calc/decimal";
import { addDays, compareDates } from "@/lib/calc/dates";
import { valuePortfolio } from "@/lib/calc/portfolio";
import { SERIES_LOOKBACK_DAYS, toPortfolioInput, type LedgerRead } from "@/lib/ledger/rows";

export type SnapshotScope = { kind: "all_users" } | { kind: "users"; userIds: string[] };

export interface SnapshotUser {
  userId: string;
  /** `max(date)` of the user's snapshots, or null. */
  lastSnapshotDate: IsoDate | null;
  /** Earliest `trade_date`, or null when the ledger is empty. */
  earliestTradeDate: IsoDate | null;
}

/** One `portfolio_snapshots` row, every value a decimal string. */
export interface SnapshotRow {
  user_id: string;
  asset_id: string;
  date: IsoDate;
  quantity: string;
  price_native: string;
  price_date: IsoDate;
  fx_rate: string | null;
  fx_date: IsoDate | null;
  base_currency: string;
  market_value_base: string;
  carried_forward: boolean;
  status: "ok" | "carried_forward" | "stale";
}

export interface SnapshotStore {
  /** Users in scope, least-recently-snapshotted first (nulls first), then by id. */
  listUsers(scope: SnapshotScope): Promise<SnapshotUser[]>;
  /** The user's ledger with series from `seriesFrom` on. */
  readLedger(userId: string, seriesFrom: IsoDate): Promise<LedgerRead>;
  /** One day's rows in ONE statement: all or nothing. */
  writeDay(userId: string, date: IsoDate, rows: SnapshotRow[]): Promise<void>;
}

export type UserStatus = "complete" | "budget_exhausted" | "nothing_to_do" | "error";

export interface UserSummary {
  userId: string;
  status: UserStatus;
  /** First and last day built in this run, when any. */
  from: IsoDate | null;
  to: IsoDate | null;
  daysBuilt: number;
  rowsWritten: number;
  /** A reviewed, value-free code. */
  errorCode: string | null;
}

export interface SnapshotSummary {
  ok: boolean;
  durationMs: number;
  users: UserSummary[];
}

export interface RunSnapshotsOptions {
  scope: SnapshotScope;
  budgetMs: number;
  /** Held back so the run always returns before the platform cuts it off. */
  reserveMs?: number;
  now: () => Date;
  /** Owns the registry: it resolves instrument kinds when it reads a ledger. */
  store: SnapshotStore;
}

const DEFAULT_RESERVE_MS = 10_000;

/** The calendars a user's portfolio trades on: packs with instruments, enabled or held (decision 21). */
export function tradingCalendars(read: LedgerRead): MarketCalendar[] {
  return read.packs.filter((p) => p.instruments.length > 0).map((p) => p.calendar);
}

/** A day is a trading day when ANY of the calendars is open. */
export function isTradingDay(calendars: readonly MarketCalendar[], date: IsoDate): boolean {
  return calendars.some((c) => isBusinessDay(c, date));
}

export function markerFor(user: SnapshotUser): IsoDate | null {
  if (user.lastSnapshotDate !== null) return addDays(user.lastSnapshotDate, 1);
  return user.earliestTradeDate;
}

/** The rows one valuation writes: decision 17's holdings, decimal strings, plus decision 22's columns. */
export function rowsFor(userId: string, read: LedgerRead, date: IsoDate): SnapshotRow[] {
  const valuation = valuePortfolio(toPortfolioInput(read), date);
  return valuation.holdings.map((h) => ({
    user_id: userId,
    asset_id: h.assetId,
    date,
    quantity: toDecimalString(h.quantity),
    price_native: toDecimalString(h.priceNative),
    price_date: h.priceDate,
    fx_rate: h.fxRate === null ? null : toDecimalString(h.fxRate),
    fx_date: h.fxDate,
    base_currency: valuation.baseCurrency,
    market_value_base: h.marketValueBase.toString(),
    carried_forward: h.carriedForward,
    status: h.status,
  }));
}

export async function runSnapshots(options: RunSnapshotsOptions): Promise<SnapshotSummary> {
  const { scope, budgetMs, now, store } = options;
  const reserveMs = options.reserveMs ?? DEFAULT_RESERVE_MS;
  const startedAt = now().getTime();
  const deadline = startedAt + budgetMs - reserveMs;
  const today = now().toISOString().slice(0, 10);
  const users: UserSummary[] = [];

  for (const user of await store.listUsers(scope)) {
    const summary: UserSummary = { userId: user.userId, status: "complete", from: null, to: null, daysBuilt: 0, rowsWritten: 0, errorCode: null };
    users.push(summary);
    const marker = markerFor(user);
    if (marker === null || compareDates(marker, today) > 0) {
      summary.status = "nothing_to_do";
      continue;
    }
    if (now().getTime() >= deadline) {
      summary.status = "budget_exhausted";
      continue;
    }
    try {
      const read = await store.readLedger(user.userId, addDays(marker, -SERIES_LOOKBACK_DAYS));
      const calendars = tradingCalendars(read);
      if (calendars.length === 0) {
        summary.status = "nothing_to_do";
        continue;
      }
      for (let day = marker; compareDates(day, today) <= 0; day = addDays(day, 1)) {
        if (!isTradingDay(calendars, day)) continue;
        if (now().getTime() >= deadline) {
          summary.status = "budget_exhausted";
          break;
        }
        const rows = rowsFor(user.userId, read, day);
        await store.writeDay(user.userId, day, rows);
        summary.from ??= day;
        summary.to = day;
        summary.daysBuilt += 1;
        summary.rowsWritten += rows.length;
      }
    } catch (err) {
      // A kernel contract violation names an id and a code, never a value;
      // anything else is reduced to a fixed literal.
      summary.status = "error";
      summary.errorCode = err instanceof Error && err.name === "KernelError" ? (err as { code?: string }).code ?? "kernel_error" : "store_failed";
    }
  }

  return { ok: users.every((u) => u.status !== "error"), durationMs: now().getTime() - startedAt, users };
}
