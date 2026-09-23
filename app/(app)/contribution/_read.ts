import { PACKS } from "@/packs";
import { addDays } from "@/lib/calc/dates";
import { readLedger, SERIES_LOOKBACK_DAYS, toPortfolioInput } from "@/lib/ledger/rows";
import { readSnapshotRange, readSnapshotTotals } from "@/lib/ledger/snapshots";
import type { Db } from "@/lib/supabase/types";
import { baseFlowsOf } from "@/app/(app)/_models/flows";
import { periodFrom } from "@/app/(app)/_models/period";
import { valueLedger } from "@/app/(app)/_lib/valuation";

/**
 * What both Contribution routes read: the period over the snapshot dates,
 * the full ledger windowed from the period start, and the valuations at
 * both ends — exactly the wiring the golden runner uses.
 */
export async function readContributionWindow(client: Db, periodParam: string | string[] | undefined) {
  const range = await readSnapshotRange(client);
  const dates = range.first ? (await readSnapshotTotals(client)).map((t) => t.date) : [];
  const period = periodFrom(periodParam, range, dates);
  if (!period) {
    const read = await readLedger(client, PACKS, { prices: "latest", seriesFrom: "9999-12-31" });
    return { period: null, read, input: null, start: null, end: null, flows: [], dropped: 0, oversold: [] } as const;
  }
  const lookback = addDays(period.from, -SERIES_LOOKBACK_DAYS);
  const read = await readLedger(client, PACKS, { pricesFrom: lookback, seriesFrom: lookback });
  const input = toPortfolioInput(read);
  const { flows, dropped } = baseFlowsOf(read, input);
  // An inconsistent ledger is a result, not a crash (SPEC §6): both ends go
  // null together, so a contribution is never computed across a broken one.
  const start = valueLedger(input, period.from);
  const end = valueLedger(input, period.to);
  const oversold = start.oversold.length > 0 ? start.oversold : end.oversold;
  return {
    period,
    read,
    input,
    start: oversold.length > 0 ? null : start.valuation,
    end: oversold.length > 0 ? null : end.valuation,
    flows,
    dropped,
    oversold,
  } as const;
}
