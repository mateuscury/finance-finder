import { PACKS } from "@/packs";
import { addDays } from "@/lib/calc/dates";
import { valuePortfolio } from "@/lib/calc/portfolio";
import { readLedger, SERIES_LOOKBACK_DAYS, toPortfolioInput } from "@/lib/ledger/rows";
import { readSnapshotRange, readSnapshotTotals } from "@/lib/ledger/snapshots";
import type { Db } from "@/lib/supabase/types";
import { baseFlowsOf } from "@/app/(app)/_models/flows";
import { periodFrom } from "@/app/(app)/_models/period";

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
    return { period: null, read, input: null, start: null, end: null, flows: [], dropped: 0 } as const;
  }
  const lookback = addDays(period.from, -SERIES_LOOKBACK_DAYS);
  const read = await readLedger(client, PACKS, { pricesFrom: lookback, seriesFrom: lookback });
  const input = toPortfolioInput(read);
  const { flows, dropped } = baseFlowsOf(read, input);
  return {
    period,
    read,
    input,
    start: valuePortfolio(input, period.from),
    end: valuePortfolio(input, period.to),
    flows,
    dropped,
  } as const;
}
