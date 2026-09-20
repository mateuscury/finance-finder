import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { planRestore } from "./restore";
import type { Backup } from "./schema";

const TS = "2026-09-20T12:00:00.000000Z";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const asset = (id: string, over: Partial<Backup["assets"][number]> = {}): Backup["assets"][number] => ({
  id,
  pack_id: "br",
  instrument_kind: "br.fii",
  identifier: "HGLG11",
  name: "HGLG11",
  native_currency: "BRL",
  metadata: { fundName: "x" },
  created_at: TS,
  updated_at: TS,
  ...over,
});
const base: Backup = {
  version: 1,
  exported_at: TS,
  settings: { base_currency: "BRL", enabled_packs: ["br"], locale: "pt-BR", theme: "system" },
  assets: [asset(A)],
  transactions: [{ id: B, asset_id: A, trade_date: "2026-02-02", type: "buy", quantity: "1", unit_price: "10.50", currency: "BRL", fees: "0", fx_rate: null, note: null, created_at: TS }],
  cash_flows: [],
  prices: [{ asset_id: A, date: "2026-02-02", price: "10.500", currency: "BRL", source_id: "br.brapi" }],
};

describe("planRestore", () => {
  it("accepts a consistent file and hands back the canonical payload", () => {
    const plan = planRestore(base, PACKS);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.warnings).toEqual([]);
    expect(plan.payload.prices[0].price).toBe("10.5");
  });

  it("refuses with the fixed reasons the database would raise", () => {
    expect(planRestore({ ...base, version: 3 }, PACKS)).toMatchObject({ ok: false, reason: "unsupported_version" });
    expect(planRestore({ ...base, assets: "nope" }, PACKS)).toMatchObject({ ok: false, reason: "invalid_backup" });
    expect(planRestore({ ...base, assets: [asset(A), asset(A, { identifier: "OTHER" })] }, PACKS)).toMatchObject({ ok: false, reason: "duplicate_asset_id" });
    expect(planRestore({ ...base, assets: [] }, PACKS)).toMatchObject({ ok: false, reason: "foreign_asset_reference" });
    const foreignPrice = planRestore({ ...base, prices: [{ ...base.prices[0], asset_id: B }] }, PACKS);
    expect(foreignPrice).toMatchObject({ ok: false, reason: "foreign_asset_reference" });
    if (!foreignPrice.ok) expect(foreignPrice.issues[0]).toMatch(/^price /);
  });

  it("warns but restores on an unknown pack, unknown kind, or metadata the pack rejects", () => {
    const plan = planRestore(
      {
        ...base,
        assets: [asset(A, { pack_id: "zz", instrument_kind: "zz.thing" }), asset(B, { instrument_kind: "br.nope" }), asset("33333333-3333-4333-8333-333333333333", { instrument_kind: "br.cdb", metadata: {} })],
      },
      PACKS,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.warnings).toEqual([
      { assetId: A, code: "unknown_pack" },
      { assetId: B, code: "unknown_instrument_kind" },
      { assetId: "33333333-3333-4333-8333-333333333333", code: "invalid_metadata" },
    ]);
    expect(plan.payload.assets).toHaveLength(3);
  });
});
