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
  rebuild: { from: IsoDate; through: IsoDate | null; target: IsoDate } | null;
  /** Sources of the user's packs whose declared variable is absent, by NAME. */
  disabledSources: { sourceId: string; variable: string }[];
  /** Data exists and the last export is older than 30 days or never (SPEC §12.3). */
  exportNudge: { lastExportAt: string | null } | null;
}

export const EXPORT_NUDGE_DAYS = 30;

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
    .select("last_snapshot_date,earliest_trade_date")
    .maybeSingle()
    .overrideTypes<{ last_snapshot_date: string | null; earliest_trade_date: string | null }, { merge: false }>();
  if (marker.error) throw new Error(`status: markers (${marker.error.code ?? "unknown"})`);
  let rebuild: LedgerStatus["rebuild"] = null;
  const calendars = packs.filter((p) => p.instruments.length > 0).map((p) => p.calendar);
  if (marker.data?.earliest_trade_date && calendars.length > 0) {
    const target = lastTradingDay(calendars, today);
    const through = marker.data.last_snapshot_date;
    if (through === null || through < target) rebuild = { from: marker.data.earliest_trade_date, through, target };
  }

  // Disabled sources: a declared variable absent from the environment (PACKS §7).
  const disabledSources: LedgerStatus["disabledSources"] = [];
  for (const pack of packs) {
    for (const source of pack.sources) {
      for (const variable of source.envVars ?? [])
        if (!env[variable]) disabledSources.push({ sourceId: source.id, variable });
    }
  }

  // Export nudge: data present and the last export stale.
  const { count } = await client.from("transactions").select("*", { count: "exact", head: true });
  let exportNudge: LedgerStatus["exportNudge"] = null;
  if ((count ?? 0) > 0) {
    const last = settings.last_export_at;
    if (last === null || addDays(last.slice(0, 10), EXPORT_NUDGE_DAYS) < today) exportNudge = { lastExportAt: last };
  }

  return { unpricedAssets, rebuild, disabledSources, exportNudge };
}
