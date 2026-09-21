import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { KernelDecimal } from "@/lib/calc/decimal";
import { stalenessWindowFor, valuePortfolio } from "@/lib/calc/portfolio";
import { groupByAsset, lotsAt } from "@/lib/calc/positions";
import { valueAccrual } from "@/lib/calc/valuation/accrual";
import { toPortfolioInput } from "@/lib/ledger/rows";
import { goldenLedgerRead, loadGoldenFixture } from "@/lib/testing/golden";
import { maturitiesModel } from "./maturities";

const { fixture } = loadGoldenFixture();
const read = goldenLedgerRead(fixture, PACKS);
const input = toPortfolioInput(read);
const today = fixture.asOf;

describe("maturitiesModel over the golden ledger", () => {
  const m = maturitiesModel({ read, input, today, valuation: valuePortfolio(input, today) });

  it("lists the five fixed-income holdings by maturity date, each with today's row", () => {
    expect(m.empty).toBe(false);
    expect(m.rows.map((r) => [r.assetId, r.maturity])).toEqual([
      ["lci", "2027-01-15"],
      ["cdb", "2028-02-02"], // same date as the prefixado: tie broken by identifier
      ["pre", "2028-02-02"],
      ["ipca", "2029-02-02"],
      ["td", "2029-03-01"],
    ]);
    expect(m.rows.every((r) => r.current.kind === "row")).toBe(true);
    expect(m.rows.every((r) => !r.matured && r.daysToGo > 0)).toBe(true);
  });

  it("the prefixado's contracted value equals valueAccrual at its maturity; indexed kinds and the NAV bond show none", () => {
    const pre = m.rows.find((r) => r.assetId === "pre")!;
    const asset = read.assets.find((a) => a.id === "pre")!;
    const lots = lotsAt(groupByAsset(read.transactions).get("pre")!, today);
    const direct = valueAccrual(asset, lots, pre.maturity, {
      market: input.market,
      calendar: input.calendars.get("br")!,
      windowDays: stalenessWindowFor(input, "br", pre.maturity),
      series: input.series,
    });
    if (direct.status !== "ok" && direct.status !== "carried_forward") throw new Error(direct.status);
    expect(new KernelDecimal(pre.contracted!).eq(direct.native.amount)).toBe(true);
    expect(pre.indexed).toBe(false);
    for (const id of ["cdb", "lci", "ipca"]) {
      const r = m.rows.find((x) => x.assetId === id)!;
      expect(r.contracted).toBeNull();
      expect(r.indexed).toBe(true);
    }
    const td = m.rows.find((r) => r.assetId === "td")!;
    expect(td.contracted).toBeNull();
    expect(td.indexed).toBe(false);
  });

  it("groups the timeline by month of maturity", () => {
    expect(m.timeline.map((t) => [t.month, t.rows.length])).toEqual([
      ["2027-01-01", 1],
      ["2028-02-01", 2],
      ["2029-02-01", 1],
      ["2029-03-01", 1],
    ]);
  });

  it("marks a holding still open past its maturity, and drops a fully sold one", () => {
    const later = maturitiesModel({ read, input, today: "2027-06-30", valuation: null });
    const lci = later.rows.find((r) => r.assetId === "lci")!;
    expect(lci.matured).toBe(true);
    expect(lci.daysToGo).toBeLessThan(0);
    expect(lci.current.kind).toBe("none");
    const sold = {
      ...read,
      transactions: [
        ...read.transactions,
        {
          id: "x",
          assetId: "lci",
          tradeDate: "2026-02-20",
          type: "sell" as const,
          quantity: "-1",
          unitPrice: "20500",
          currency: "BRL",
          fees: "0",
          fxRate: null,
        },
      ],
    };
    expect(
      maturitiesModel({ read: sold, input: toPortfolioInput(sold), today, valuation: null }).rows.map((r) => r.assetId),
    ).not.toContain("lci");
  });

  it("is empty for a ledger with no fixed income", () => {
    const stocks = { ...read, assets: read.assets.filter((a) => a.id === "fii" || a.id === "stk") };
    expect(maturitiesModel({ read: stocks, input: toPortfolioInput(stocks), today, valuation: null }).empty).toBe(true);
  });
});
