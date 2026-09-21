import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PACKS } from "@/packs";
import { brPack } from "@/packs/br";
import type { InstrumentKind } from "@/packs/types";
import { goldenLedgerRead, loadGoldenFixture } from "@/lib/testing/golden";
import { hasMaturity, isPlainRateAccrual, maturityOf } from "./maturity";

const kind = (id: string) => brPack.instruments.find((k) => k.id === id)!;

describe("the maturity convention (decision 38)", () => {
  it("hasMaturity reads the schema shape: the four BR credits and Tesouro Direto have it; the FII and the stock do not", () => {
    expect(
      ["br.cdb", "br.lci_lca", "br.cdb_prefixado", "br.cdb_ipca", "br.tesouro_direto"].map((id) =>
        hasMaturity(kind(id)),
      ),
    ).toEqual([true, true, true, true, true]);
    expect(["br.fii", "br.stock"].map((id) => hasMaturity(kind(id)))).toEqual([false, false]);
  });

  it("a kind from any pack with `maturity` in its shape counts, by shape alone", () => {
    const foreign: InstrumentKind = {
      id: "zz.gilt",
      label: "Gilt",
      valuation: { kind: "curve_mark_to_market", seriesId: "zz.curve" },
      metadataSchema: z.object({ maturity: z.string(), coupon: z.string() }),
      identifier: "isin",
      quoteCurrency: "GBP",
    };
    expect(hasMaturity(foreign)).toBe(true);
    expect(hasMaturity({ ...foreign, metadataSchema: z.object({ name: z.string() }) })).toBe(false);
    expect(hasMaturity({ ...foreign, metadataSchema: z.string() })).toBe(false);
  });

  it("maturityOf parses the golden metadata and is null without a valid date", () => {
    const { fixture } = loadGoldenFixture();
    const read = goldenLedgerRead(fixture, PACKS);
    const byId = Object.fromEntries(read.assets.map((a) => [a.id, maturityOf(a)]));
    expect(byId.pre).toBe("2028-02-02");
    expect(byId.td).toBe("2029-03-01");
    expect(byId.fii).toBeNull();
    expect(maturityOf({ ...read.assets[0], metadata: { maturity: "soon" } })).toBeNull();
  });

  it("isPlainRateAccrual is the prefixado only", () => {
    expect(brPack.instruments.filter(isPlainRateAccrual).map((k) => k.id)).toEqual(["br.cdb_prefixado"]);
  });
});
