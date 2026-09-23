/**
 * What the status strip shows (SPEC §9.2 "Status strip"; §9.4; §12.3
 * "Backup reminder"): the pending conditions of one user, each with the
 * screen that resolves it. Read through the user's own client — the
 * markers view and the latest-price view are `security_invoker` — so the
 * strip never needs the service role. Nothing here is a value: counts,
 * dates, source ids and variable NAMES only.
 */
import type { IsoDate, MarketPack } from "@/packs/types";
import { isBusinessDay } from "@/lib/calc/calendar";
import { addDays } from "@/lib/calc/dates";
import { resolveActivation } from "@/lib/packs/activate";
import { readAll } from "@/lib/supabase/paginate";
import type { Db } from "@/lib/supabase/types";
import { readSettings, resolveAssets, ASSET_SELECT, type AssetDbRow } from "./rows";

export interface LedgerStatus {
  /** Market and NAV assets with no price at all (SPEC §9.4). */
  unpricedAssets: number;
  /** History still to build: from the first trade (or the day after the last snapshot) to the last trading day. */
  rebuild: {
    from: IsoDate;
    through: IsoDate | null;
    target: IsoDate;
    /** Nothing has been written into the gap for two trading days: stalled, not progressing. */
    stalled: boolean;
  } | null;
  /** Sources of the user's packs whose declared variable is absent, by NAME. */
  disabledSources: { sourceId: string; variable: string }[];
  /** Data exists and the last export is older than 30 days or never (SPEC §12.3). */
  exportNudge: { lastExportAt: string | null } | null;
  /**
   * No price run for two trading days, with something held (SPEC §9.2
   * "Liveness"; decision 63). `lastRunAt` is null when none ever ran.
   */
  ingestStale: { lastRunAt: string | null } | null;
  /** Sources whose last attempt recorded an error, by id and reason code. */
  failingSources: { sourceId: string; code: string }[];
  /**
   * The plain facts Settings → Instance states (SPEC §12.3). Reported whether
   * or not anything is wrong: "when did this last run" is a question the owner
   * may ask on a healthy instance too, and a fallback to today would answer it
   * with a run that never happened.
   */
  lastIngestRunAt: string | null;
  snapshotsThrough: IsoDate | null;
  snapshotsWrittenAt: string | null;
}

export const EXPORT_NUDGE_DAYS = 30;
/**
 * How many trading days of silence make a cron "stopped" rather than "late".
 * One is a single missed night, which a manual Refresh or a slow source
 * explains; two is a pattern (decision 63).
 */
export const LIVENESS_TRADING_DAYS = 2;

/** `n` trading days before `date`, over the union of the calendars. */
export function tradingDaysBack(calendars: readonly MarketPack["calendar"][], date: IsoDate, n: number): IsoDate {
  let day = date;
  for (let left = n; left > 0; left -= 1) day = lastTradingDay(calendars, addDays(day, -1));
  return day;
}

/** Walks back from `today` to the most recent day any of the calendars trades on. */
export function lastTradingDay(calendars: readonly MarketPack["calendar"][], today: IsoDate): IsoDate {
  let day = today;
  for (let i = 0; i < 31; i += 1) {
    if (calendars.some((c) => isBusinessDay(c, day))) return day;
    day = addDays(day, -1);
  }
  return today;
}

export async function readStatus(
  client: Db,
  registry: readonly MarketPack[],
  env: Readonly<Record<string, string | undefined>>,
  today: IsoDate,
): Promise<LedgerStatus> {
  const settings = await readSettings(client);
  const assetRows = await readAll<AssetDbRow>((from, to) =>
    client.from("assets").select(ASSET_SELECT).order("id").range(from, to),
  );
  const { assets } = resolveAssets(assetRows, registry);
  const packs = resolveActivation(registry, [
    ...new Set([...(settings.enabled_packs ?? []), ...assets.map((a) => a.packId)]),
  ]).packs;

  // Unpriced: market and NAV kinds with no row in the latest-price view.
  const priceable = assets.filter(
    (a) => a.instrumentKind.valuation.kind === "market_price" || a.instrumentKind.valuation.kind === "nav_unit_price",
  );
  const priced = new Set<string>();
  for (let i = 0; i < priceable.length; i += 100) {
    const chunk = priceable.slice(i, i + 100).map((a) => a.id);
    const rows = await readAll<{ asset_id: string }>((from, to) =>
      client
        .from("asset_latest_prices")
        .select("asset_id")
        .in("asset_id", chunk)
        .order("asset_id")
        .range(from, to)
        .overrideTypes<{ asset_id: string }[]>(),
    );
    for (const r of rows) priced.add(r.asset_id);
  }
  const unpricedAssets = priceable.filter((a) => !priced.has(a.id)).length;

  // Rebuild: the user's own marker row.
  const marker = await client
    .from("snapshot_markers")
    .select("last_snapshot_date,earliest_trade_date,last_snapshot_written_at")
    .maybeSingle()
    .overrideTypes<
      {
        last_snapshot_date: string | null;
        earliest_trade_date: string | null;
        last_snapshot_written_at: string | null;
      },
      { merge: false }
    >();
  if (marker.error) throw new Error(`status: markers (${marker.error.code ?? "unknown"})`);
  let rebuild: LedgerStatus["rebuild"] = null;
  const calendars = packs.filter((p) => p.instruments.length > 0).map((p) => p.calendar);
  // The cut-off every liveness item is judged against: two trading days before
  // the last one the market was open (decision 63).
  const target = calendars.length > 0 ? lastTradingDay(calendars, today) : today;
  const limit = calendars.length > 0 ? tradingDaysBack(calendars, target, LIVENESS_TRADING_DAYS) : today;
  if (marker.data?.earliest_trade_date && calendars.length > 0) {
    const through = marker.data.last_snapshot_date;
    if (through === null || through < target) {
      const writtenOn = marker.data.last_snapshot_written_at?.slice(0, 10) ?? null;
      rebuild = {
        from: marker.data.earliest_trade_date,
        through,
        target,
        stalled: writtenOn === null || writtenOn < limit,
      };
    }
  }

  // Disabled sources: a declared variable absent from the environment (PACKS §7).
  const disabledSources: LedgerStatus["disabledSources"] = [];
  for (const pack of packs) {
    for (const source of pack.sources) {
      for (const variable of source.envVars ?? [])
        if (!env[variable]) disabledSources.push({ sourceId: source.id, variable });
    }
  }
  // A disabled source has its own strip item; it is not also "failing" or
  // evidence that the cron stopped.
  const disabled = new Set(disabledSources.map((d) => d.sourceId));

  // Liveness (decision 63). The cursors are read through the user's own client
  // — `ingest_cursors` grants SELECT to `authenticated`; only cron writes.
  const activeSources = packs.flatMap((p) => p.sources).filter((src) => !disabled.has(src.id));
  const cursors =
    activeSources.length === 0
      ? []
      : await readAll<{ source_id: string; last_run_at: string | null; last_error: string | null }>((from, to) =>
          client
            .from("ingest_cursors")
            .select("source_id,last_run_at,last_error")
            .in(
              "source_id",
              activeSources.map((src) => src.id),
            )
            .order("source_id")
            .range(from, to),
        );
  const failingSources = cursors
    .filter((c) => c.last_error !== null && c.last_error !== "")
    .map((c) => ({ sourceId: c.source_id, code: c.last_error as string }));

  // Export nudge: data present and the last export stale.
  const { count } = await client.from("transactions").select("*", { count: "exact", head: true });
  let exportNudge: LedgerStatus["exportNudge"] = null;
  if ((count ?? 0) > 0) {
    const last = settings.last_export_at;
    if (last === null || addDays(last.slice(0, 10), EXPORT_NUDGE_DAYS) < today) exportNudge = { lastExportAt: last };
  }

  // A cron that has not run for two trading days, with something held. An
  // account younger than that has no missed run to report: its own created_at
  // is the floor, so a fresh instance is silent rather than alarming.
  const runs = cursors.map((c) => c.last_run_at).filter((v): v is string => v !== null);
  const lastIngestRunAt = runs.length > 0 ? (runs.slice().sort().at(-1) as string) : null;
  let ingestStale: LedgerStatus["ingestStale"] = null;
  if ((count ?? 0) > 0 && activeSources.length > 0) {
    const created = settings.created_at === "" ? null : settings.created_at;
    const reference =
      [lastIngestRunAt, created]
        .filter((v): v is string => v !== null)
        .sort()
        .at(-1) ?? null;
    if (reference === null || reference.slice(0, 10) < limit) ingestStale = { lastRunAt: lastIngestRunAt };
  }

  return {
    unpricedAssets,
    rebuild,
    disabledSources,
    exportNudge,
    ingestStale,
    failingSources,
    lastIngestRunAt,
    snapshotsThrough: (marker.data?.last_snapshot_date as IsoDate | null) ?? null,
    snapshotsWrittenAt: marker.data?.last_snapshot_written_at ?? null,
  };
}
