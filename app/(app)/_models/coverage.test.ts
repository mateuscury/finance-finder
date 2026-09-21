import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { goldenLedgerRead, loadGoldenFixture } from "@/lib/testing/golden";
import { coverTotals } from "./coverage";

const { fixture, expected } = loadGoldenFixture();
const read = goldenLedgerRead(fixture, PACKS);
const total = (date: string, rows: number, staleRows = 0) => ({
  date,
  baseCurrency: "BRL",
  totalBase: "1",
  rows,
  staleRows,
  carriedRows: 0,
});

describe("coverTotals (decision 53)", () => {
  it("counts the holdings open on each date from the ledger and marks a date complete only when every one has a confident row", () => {
    // Golden: LCI from 15 Jan; five more on 2 Feb; the stock on 10 Feb; the FII partly sold on 18 Feb (still open).
    const covered = coverTotals(
      [
        total("2026-01-20", 1),
        total("2026-02-05", 6),
        total("2026-02-12", 7),
        total("2026-02-27", 5),
        total("2026-02-19", 7, 1),
      ],
      read.transactions,
    );
    expect(covered.map((c) => [c.date, c.openHoldings, c.complete])).toEqual([
      ["2026-01-20", 1, true],
      ["2026-02-05", 6, true],
      ["2026-02-12", 7, true],
      ["2026-02-27", 7, false], // two holdings unpriced: no rows for them
      ["2026-02-19", 7, false], // a stale row
    ]);
  });

  it("every golden valuation date is complete when its row count matches expected.json's valuation", () => {
    const perDate = Object.keys(expected.valuations as Record<string, string>).sort();
    const covered = coverTotals(
      perDate.map((d) => total(d, 7)),
      read.transactions,
    );
    expect(covered.every((c) => c.complete)).toBe(true);
    expect(covered[0].openHoldings).toBe(7);
  });
});
