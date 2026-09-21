import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { toPortfolioInput } from "@/lib/ledger/rows";
import { goldenLedgerRead, loadGoldenFixture } from "@/lib/testing/golden";
import { baseFlowsOf } from "./flows";

const { fixture } = loadGoldenFixture();

describe("baseFlowsOf (decision 54)", () => {
  it("passes base-currency flows through unchanged", () => {
    const read = goldenLedgerRead(fixture, PACKS);
    const { flows, dropped } = baseFlowsOf(read, toPortfolioInput(read));
    expect(flows).toEqual(fixture.cashFlows.map((f) => ({ date: f.date, amount: f.amount })));
    expect(dropped).toBe(0);
  });

  it("converts a foreign flow with the FX series at its date, and drops one it cannot convert", () => {
    const read = goldenLedgerRead(fixture, PACKS);
    read.cashFlows = [
      { id: "usd", date: "2026-02-10", amount: "100", currency: "USD" },
      { id: "gbp", date: "2026-02-10", amount: "100", currency: "GBP" },
    ];
    read.series = [...read.series, { seriesId: "global.usdbrl", date: "2026-02-10", value: "5.20", tenorDays: 0 }];
    const { flows, dropped } = baseFlowsOf(read, toPortfolioInput(read));
    expect(flows).toEqual([{ date: "2026-02-10", amount: "520" }]);
    expect(dropped).toBe(1);
  });
});
