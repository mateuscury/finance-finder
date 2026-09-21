import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { attribution } from "@/lib/calc/attribution";
import { contribution } from "@/lib/calc/contribution";
import { KernelDecimal } from "@/lib/calc/decimal";
import { valuePortfolio } from "@/lib/calc/portfolio";
import { toPortfolioInput } from "@/lib/ledger/rows";
import { goldenLedgerRead, loadGoldenFixture } from "@/lib/testing/golden";
import { attributionModel, contributionModel } from "./contribution";
import { baseFlowsOf } from "./flows";

const { fixture, expected } = loadGoldenFixture();
const read = goldenLedgerRead(fixture, PACKS);
const input = toPortfolioInput(read);
const dates = [...fixture.valuationDates].sort();
const from = dates[0];
const to = fixture.asOf;
const identifiers = Object.fromEntries(read.assets.map((a) => [a.id, a.identifier]));
const golden = expected.contribution as { assets: Record<string, string>; total: string };

function run(over: Partial<Parameters<typeof contribution>[0]> = {}) {
  const { flows } = baseFlowsOf(read, input);
  return contribution({
    input,
    from,
    to,
    start: valuePortfolio(input, from),
    end: valuePortfolio(input, to),
    flows,
    ...over,
  });
}

describe("contributionModel over the golden ledger", () => {
  it("every asset's contribution equals expected.json's to 1e-8, the total the golden total, rows by magnitude", () => {
    const m = contributionModel({ result: run(), identifiers, names: read.names, droppedFlows: 0 });
    expect(m.rows).toHaveLength(7);
    for (const row of m.rows) {
      expect(new KernelDecimal(row.contribution!).minus(golden.assets[row.assetId]).abs().lt("1e-8"), row.assetId).toBe(
        true,
      );
      expect(row.gain).not.toBeNull();
    }
    expect(new KernelDecimal(m.total!).minus(golden.total).abs().lt("1e-8")).toBe(true);
    for (let i = 1; i < m.rows.length; i += 1) {
      expect(
        new KernelDecimal(m.rows[i - 1].contribution!).abs().gte(new KernelDecimal(m.rows[i].contribution!).abs()),
      ).toBe(true);
    }
    expect(m.partial).toBe(false);
    expect(m.reasons).toEqual({});
    expect(m.rows[0].name).toBe(read.names[m.rows[0].assetId]);
  });

  it("a missing FX series makes that asset null with no_fx_series, sorted last, and the total partial", () => {
    // A USD-quoted holding with no FX series in scope: the kernel cannot convert its flows.
    const usd = {
      ...read,
      assets: read.assets.map((a) => (a.id === "stk" ? { ...a, nativeCurrency: "USD" } : a)),
      prices: read.prices.map((p) => (p.assetId === "stk" ? { ...p, currency: "USD" } : p)),
      transactions: read.transactions.map((x) => (x.assetId === "stk" ? { ...x, currency: "USD" } : x)),
    };
    const usdInput = toPortfolioInput(usd);
    const { flows } = baseFlowsOf(usd, usdInput);
    const result = contribution({
      input: usdInput,
      from,
      to,
      start: valuePortfolio(usdInput, from),
      end: valuePortfolio(usdInput, to),
      flows,
    });
    const m = contributionModel({ result, identifiers, names: read.names, droppedFlows: 0 });
    const stk = m.rows.find((r) => r.assetId === "stk")!;
    expect(stk.contribution).toBeNull();
    expect(stk.reason).toBe("no_fx_series");
    expect(m.rows.at(-1)!.assetId).toBe("stk");
    expect(m.partial).toBe(true);
    expect(m.reasons).toEqual({ no_fx_series: 1 });
  });

  it("dropped flows mark the figure partial", () => {
    expect(contributionModel({ result: run(), identifiers, names: read.names, droppedFlows: 1 }).partial).toBe(true);
  });
});

describe("attributionModel over the golden ledger", () => {
  it("every BR asset has R_fx exactly zero and is base-currency; the legs are strings", () => {
    for (const a of read.assets) {
      const m = attributionModel(attribution(input, a.id, from, to));
      expect(m.isBaseCurrency, a.id).toBe(true);
      expect(m.rFx).toBe("0");
      expect(m.rBase).toBe(m.rNative);
      expect(m.reason).toBeNull();
    }
  });

  it("an asset never held in the window is no_position with null legs", () => {
    const m = attributionModel(attribution(input, "stk", "2026-01-15", "2026-02-02"));
    expect(m).toMatchObject({ reason: "no_position", rNative: null, rFx: null, rBase: null, isBaseCurrency: false });
  });
});
