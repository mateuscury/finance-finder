import { describe, expect, it } from "vitest";
import {
  AssetInputSchema,
  CashFlowInputSchema,
  failedFields,
  ManualPriceInputSchema,
  TransactionInputSchema,
} from "./schemas";

const base = { asset_id: "11111111-1111-4111-8111-111111111111", trade_date: "2026-02-02", currency: "BRL" };

describe("TransactionInputSchema mirrors the database checks", () => {
  it.each([
    ["buy", "10", true],
    ["buy", "-10", false],
    ["buy", "0", false],
    ["sell", "-10", true],
    ["sell", "10", false],
    ["dividend", "0", true],
    ["dividend", "0.0", true],
    ["dividend", "1", false],
    ["interest", "0", true],
    ["fee", "-1", false],
  ])("%s with quantity %s → %s", (type, quantity, valid) => {
    const r = TransactionInputSchema.safeParse({ ...base, type, quantity, unit_price: "1" });
    expect(r.success).toBe(valid);
    if (!r.success) expect(failedFields(r.error)).toEqual(["quantity"]);
  });

  it("unit_price must be positive, fees non-negative, dates real, values decimal strings", () => {
    expect(TransactionInputSchema.safeParse({ ...base, type: "buy", quantity: "1", unit_price: "0" }).success).toBe(
      false,
    );
    expect(TransactionInputSchema.safeParse({ ...base, type: "buy", quantity: "1", unit_price: "-5" }).success).toBe(
      false,
    );
    expect(
      TransactionInputSchema.safeParse({ ...base, type: "buy", quantity: "1", unit_price: "5", fees: "-1" }).success,
    ).toBe(false);
    expect(
      TransactionInputSchema.safeParse({
        ...base,
        type: "buy",
        quantity: "1",
        unit_price: "5",
        trade_date: "2026-02-30",
      }).success,
    ).toBe(false);
    expect(TransactionInputSchema.safeParse({ ...base, type: "buy", quantity: 1, unit_price: "5" }).success).toBe(
      false,
    );
    expect(TransactionInputSchema.safeParse({ ...base, type: "buy", quantity: "1e3", unit_price: "5" }).success).toBe(
      false,
    );
    const ok = TransactionInputSchema.safeParse({ ...base, type: "buy", quantity: "1.5", unit_price: "0.01" });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data).toMatchObject({ fees: "0", note: null });
  });

  it("names every failing field", () => {
    const r = TransactionInputSchema.safeParse({
      ...base,
      type: "buy",
      quantity: "-1",
      unit_price: "0",
      currency: "brl",
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(failedFields(r.error).sort()).toEqual(["currency", "quantity", "unit_price"]);
  });
});

describe("CashFlowInputSchema / ManualPriceInputSchema / AssetInputSchema", () => {
  it("cash flows refuse zero and carry no currency field", () => {
    expect(CashFlowInputSchema.safeParse({ date: "2026-02-02", amount: "0" }).success).toBe(false);
    expect(CashFlowInputSchema.safeParse({ date: "2026-02-02", amount: "0.00" }).success).toBe(false);
    expect(CashFlowInputSchema.safeParse({ date: "2026-02-02", amount: "-4648.50" }).success).toBe(true);
    expect("currency" in CashFlowInputSchema.shape).toBe(false);
  });

  it("manual prices are positive decimals on real dates", () => {
    expect(ManualPriceInputSchema.safeParse({ asset_id: base.asset_id, date: "2026-02-02", price: "0" }).success).toBe(
      false,
    );
    expect(
      ManualPriceInputSchema.safeParse({ asset_id: base.asset_id, date: "2026-02-02", price: "155.50" }).success,
    ).toBe(true);
  });

  it("assets need a pack, a prefixed kind, an identifier, a name and an ISO currency", () => {
    expect(
      AssetInputSchema.safeParse({
        pack_id: "br",
        instrument_kind: "br.fii",
        identifier: "HGLG11",
        name: "x",
        native_currency: "BRL",
      }).success,
    ).toBe(true);
    expect(
      AssetInputSchema.safeParse({
        pack_id: "BR",
        instrument_kind: "br.fii",
        identifier: "HGLG11",
        name: "x",
        native_currency: "BRL",
      }).success,
    ).toBe(false);
    expect(
      AssetInputSchema.safeParse({
        pack_id: "br",
        instrument_kind: "fii",
        identifier: "HGLG11",
        name: "x",
        native_currency: "BRL",
      }).success,
    ).toBe(false);
    expect(
      AssetInputSchema.safeParse({
        pack_id: "br",
        instrument_kind: "br.fii",
        identifier: " ",
        name: "x",
        native_currency: "BRL",
      }).success,
    ).toBe(false);
  });
});
