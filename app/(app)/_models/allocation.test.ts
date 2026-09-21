import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { KernelDecimal } from "@/lib/calc/decimal";
import { valuePortfolio } from "@/lib/calc/portfolio";
import { toPortfolioInput } from "@/lib/ledger/rows";
import type { SnapshotAssetRow } from "@/lib/ledger/snapshots";
import { goldenLedgerRead, loadGoldenFixture } from "@/lib/testing/golden";
import { allocationModel } from "./allocation";

const { fixture, expected } = loadGoldenFixture();
const read = goldenLedgerRead(fixture, PACKS);

function rowsAt(date: string): SnapshotAssetRow[] {
  return valuePortfolio(toPortfolioInput(read), date).holdings.map((h) => ({
    assetId: h.assetId,
    date,
    quantity: h.quantity.toString(),
    priceNative: h.priceNative.toString(),
    priceDate: h.priceDate,
    fxRate: null,
    fxDate: null,
    baseCurrency: "BRL",
    marketValueBase: h.marketValueBase.toString(),
    carriedForward: h.carriedForward,
    status: h.status as SnapshotAssetRow["status"],
  }));
}
const sum = (xs: readonly { share: string }[]) => xs.reduce((s, x) => s.plus(x.share), new KernelDecimal(0));

describe("allocationModel over the golden asOf rows", () => {
  const m = allocationModel({ rows: rowsAt(fixture.asOf), assets: read.assets, names: read.names });

  it("every view's shares sum to exactly 100.00 and the seven kinds appear, largest first", () => {
    expect(m.empty).toBe(false);
    expect(sum(m.byKind).eq(1)).toBe(true);
    expect(sum(m.byPack).eq(1)).toBe(true);
    expect(sum(m.byCurrency).eq(1)).toBe(true);
    expect(m.byKind).toHaveLength(7);
    expect(m.byKind.map((s) => s.key)).toContain("br.stock");
    for (let i = 1; i < m.byKind.length; i += 1)
      expect(new KernelDecimal(m.byKind[i - 1].valueBase).gte(m.byKind[i].valueBase)).toBe(true);
    expect(m.byPack).toEqual([expect.objectContaining({ key: "br", share: "1" })]);
  });

  it("the kinds' values add to the golden total; BRL-only exposure has native = base", () => {
    const total = m.byKind.reduce((s, k) => s.plus(k.valueBase), new KernelDecimal(0));
    expect(
      total
        .minus((expected.valuation as { total: string }).total)
        .abs()
        .lt("1e-8"),
    ).toBe(true);
    expect(m.exposure).toHaveLength(1);
    expect(m.exposure[0].currency).toBe("BRL");
    expect(new KernelDecimal(m.exposure[0].native).minus(m.exposure[0].base).abs().lt("1e-8")).toBe(true);
  });

  it("a stale row is listed aside with its last known value and takes no share", () => {
    const rows = rowsAt(fixture.asOf).map((r) => (r.assetId === "fii" ? { ...r, status: "stale" as const } : r));
    const s = allocationModel({ rows, assets: read.assets, names: read.names });
    expect(s.stale).toEqual([expect.objectContaining({ assetId: "fii", identifier: "HGLG11" })]);
    expect(s.byKind.map((k) => k.key)).not.toContain("br.fii");
    expect(sum(s.byKind).eq(1)).toBe(true);
  });

  it("is empty with no confident row, and keeps an unknown asset in the totals labelled by id", () => {
    expect(allocationModel({ rows: [], assets: read.assets, names: read.names }).empty).toBe(true);
    const rows = rowsAt(fixture.asOf).map((r) => (r.assetId === "stk" ? { ...r, assetId: "ghost" } : r));
    const g = allocationModel({ rows, assets: read.assets, names: read.names });
    expect(g.unresolved).toBe(1);
    expect(g.byKind.some((k) => k.key === "?")).toBe(true);
  });
});
