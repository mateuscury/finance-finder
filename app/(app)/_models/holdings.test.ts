import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { KernelDecimal, ZERO } from "@/lib/calc/decimal";
import { valuePortfolio } from "@/lib/calc/portfolio";
import type { LedgerTransaction } from "@/lib/calc/types";
import { toPortfolioInput } from "@/lib/ledger/rows";
import type { AssetListItem } from "@/lib/ledger/queries";
import { goldenLedgerRead, loadGoldenFixture } from "@/lib/testing/golden";
import { holdingsModel, type HoldingsInput } from "./holdings";

const { fixture, expected } = loadGoldenFixture();
const read = goldenLedgerRead(fixture, PACKS);
const TODAY = fixture.asOf;

/** The golden's assets as the list read returns them (SPEC §9 screen 6 reads both). */
const assetList: AssetListItem[] = read.assets.map((a) => ({
  id: a.id,
  pack_id: a.packId,
  instrument_kind: a.instrumentKind.id,
  identifier: a.identifier,
  name: read.names[a.id] ?? a.identifier,
  native_currency: a.nativeCurrency,
  metadata: a.metadata,
  kindLabel: a.instrumentKind.label,
  valuation: a.instrumentKind.valuation.kind,
  sourceId: null,
  latest: null,
  sourceError: null,
}));

const base = (over: Partial<HoldingsInput> = {}): HoldingsInput => ({
  valuation: valuePortfolio(toPortfolioInput(read), TODAY),
  transactions: read.transactions,
  assets: assetList,
  baseCurrency: "BRL",
  today: TODAY,
  ...over,
});

const rowFor = (id: string, over: Partial<HoldingsInput> = {}) => {
  const row = holdingsModel(base(over)).rows.find((r) => r.assetId === id);
  if (!row) throw new Error(`no row for ${id}`);
  return row;
};

describe("holdingsModel over the golden ledger", () => {
  it("the confident total is the kernel's own — the number the Overview headline shows (AC-015.2)", () => {
    const m = holdingsModel(base());
    expect(m.baseCurrency).toBe("BRL");
    expect(
      new KernelDecimal(m.totalBase!)
        .minus((expected.valuation as { total: string }).total)
        .abs()
        .lt("1e-8"),
    ).toBe(true);
  });

  it("quantity and open cost are the FIFO lots', summed independently here (AC-015.1)", () => {
    for (const asset of read.assets) {
      const row = rowFor(asset.id);
      // The test does its own arithmetic over the fixture's rows rather than
      // trusting the kernel it is checking.
      const rows = read.transactions.filter((t) => t.assetId === asset.id && t.tradeDate <= TODAY);
      const bought = rows.filter((t) => t.type === "buy").reduce((s, t) => s.plus(new KernelDecimal(t.quantity)), ZERO);
      const sold = rows
        .filter((t) => t.type === "sell")
        .reduce((s, t) => s.plus(new KernelDecimal(t.quantity).abs()), ZERO);
      expect(new KernelDecimal(row.quantity).eq(bought.minus(sold))).toBe(true);
      if (new KernelDecimal(row.quantity).isZero()) {
        expect(row.openCost).toBeNull();
        expect(row.averageCost).toBeNull();
      } else {
        // average × quantity === openCost, to the kernel's precision.
        const product = new KernelDecimal(row.averageCost!).times(row.quantity);
        expect(product.minus(row.openCost!).abs().lt("1e-18")).toBe(true);
      }
    }
  });

  it("unrealised is market value native − open cost, and only on a confident row (AC-015.1)", () => {
    const m = holdingsModel(base());
    for (const row of m.rows) {
      if (row.unrealised === null) {
        // Either nothing is held, or the value behind it is not one we stand behind.
        expect(
          new KernelDecimal(row.quantity).isZero() ||
            row.status === "stale" ||
            row.status === "unpriced" ||
            row.status === "accrues" ||
            row.ledgerError !== null,
        ).toBe(true);
        continue;
      }
      expect(row.status === "ok" || row.status === "carried_forward").toBe(true);
      const delta = new KernelDecimal(row.marketValueNative!).minus(row.openCost!);
      expect(new KernelDecimal(row.unrealised.delta).minus(delta).abs().lt("1e-18")).toBe(true);
      if (row.unrealised.rate !== null) {
        const rate = delta.div(row.openCost!);
        expect(new KernelDecimal(row.unrealised.rate).minus(rate).abs().lt("1e-18")).toBe(true);
      }
    }
  });

  it("fees are outside cost: the golden's buy fees appear in no cost figure (decision 59)", () => {
    const withFees = read.transactions.filter((t) => t.type === "buy" && new KernelDecimal(t.fees).gt(0));
    expect(withFees.length).toBeGreaterThan(0); // the fixture must actually exercise this
    for (const t of withFees) {
      const row = rowFor(t.assetId);
      if (row.openCost === null) continue;
      const gross = read.transactions
        .filter((x) => x.assetId === t.assetId && x.type === "buy" && x.tradeDate <= TODAY)
        .reduce((s, x) => s.plus(new KernelDecimal(x.quantity).times(x.unitPrice)), ZERO);
      // Open cost never exceeds gross buy cost, and gross excludes every fee.
      expect(new KernelDecimal(row.openCost).lte(gross)).toBe(true);
    }
  });

  it("an asset with no transactions shows quantity 0 and nothing else (AC-015.1, SPEC §9.5)", () => {
    const untraded: AssetListItem = { ...assetList[0], id: "untraded", identifier: "ZZZZ11", name: "Never bought" };
    const row = rowFor("untraded", { assets: [...assetList, untraded] });
    expect(row).toMatchObject({
      quantity: "0",
      averageCost: null,
      openCost: null,
      price: null,
      marketValueBase: null,
      unrealised: null,
      ledgerError: null,
    });
    // It sorts last, below everything that is actually held.
    const rows = holdingsModel(base({ assets: [...assetList, untraded] })).rows;
    expect(rows.at(-1)?.assetId).toBe("untraded");
  });

  it("one oversold asset marks its own row and leaves every other row intact (AC-015.6)", () => {
    const victim = read.assets[0];
    const oversell: LedgerTransaction = {
      id: "zzz-oversell",
      assetId: victim.id,
      tradeDate: TODAY,
      type: "sell",
      quantity: "-999999",
      unitPrice: "1",
      currency: victim.nativeCurrency,
      fees: "0",
      fxRate: null,
    };
    const transactions = [...read.transactions, oversell];
    // The kernel itself cannot value this portfolio at all — which is the case
    // the page must survive.
    expect(() => valuePortfolio(toPortfolioInput({ ...read, transactions }), TODAY)).toThrow();

    const m = holdingsModel(base({ transactions, valuation: null }));
    const broken = m.rows.find((r) => r.assetId === victim.id)!;
    expect(broken.ledgerError).toBe("oversell");
    expect(broken.quantity).toBe("0");
    expect(broken.marketValueBase).toBeNull();
    expect(m.ledgerErrors).toBe(1);
    // Every other asset still reports its quantity and its cost.
    const others = m.rows.filter((r) => r.assetId !== victim.id && r.ledgerError === null);
    expect(others.length).toBe(read.assets.length - 1);
    expect(others.some((r) => !new KernelDecimal(r.quantity).isZero())).toBe(true);
    expect(m.totalBase).toBeNull();
  });

  it("counts open holdings left out of the total, and orders by what is worth most", () => {
    const m = holdingsModel(base());
    const confident = m.rows.filter((r) => r.status === "ok" || r.status === "carried_forward");
    expect(m.outsideTotal).toBe(
      m.rows.filter((r) => !new KernelDecimal(r.quantity).isZero() && !confident.includes(r)).length,
    );
    const values = confident.map((r) => new KernelDecimal(r.marketValueBase!));
    for (let i = 1; i < values.length; i += 1) expect(values[i - 1].gte(values[i])).toBe(true);
  });
});
