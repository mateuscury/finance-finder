import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { createAsset, deleteAsset, normalizeIdentifier, prepareAsset, updateAsset } from "./assets";
import { createCashFlow } from "./cashFlows";
import { fakeClient } from "./fake-client";
import { setManualPrice } from "./prices";
import { reasonFor } from "./result";
import { changeBaseCurrency } from "./settings";
import { createTransaction, deleteTransaction, updateTransaction } from "./transactions";

const U = "11111111-1111-4111-8111-111111111111";
const A = "22222222-2222-4222-8222-222222222222";
const fii = { pack_id: "br", instrument_kind: "br.fii", identifier: "hglg11", name: "CSHG Logística", native_currency: "BRL", metadata: { fundName: "x" } };

describe("prepareAsset", () => {
  it("normalises the identifier per the kind's spec and validates metadata against the pack schema", () => {
    const r = prepareAsset(fii, PACKS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.identifier).toBe("HGLG11");
    expect(prepareAsset({ ...fii, metadata: {} }, PACKS)).toEqual({ ok: false, reason: "invalid_metadata", fields: ["metadata"] });
    expect(prepareAsset({ ...fii, instrument_kind: "br.nope" }, PACKS)).toEqual({ ok: false, reason: "unknown_kind", fields: ["instrument_kind"] });
    expect(prepareAsset({ ...fii, identifier: "not a ticker!" }, PACKS)).toEqual({ ok: false, reason: "invalid_input", fields: ["identifier"] });
    expect(prepareAsset({ ...fii, native_currency: "brl" }, PACKS)).toEqual({ ok: false, reason: "invalid_input", fields: ["native_currency"] });
  });

  it("normalizeIdentifier: tickers upper-case, ISINs checked, custom kept", () => {
    expect(normalizeIdentifier("ticker", " hglg11 ")).toBe("HGLG11");
    expect(normalizeIdentifier("isin", "br0aaaaaaaa1")).toBe("BR0AAAAAAAA1");
    expect(normalizeIdentifier("isin", "nope")).toBeNull();
    expect(normalizeIdentifier("custom", " td:tesouro-selic:2029-03-01 ")).toBe("td:tesouro-selic:2029-03-01");
    expect(normalizeIdentifier("custom", "  ")).toBeNull();
  });
});

describe("asset actions", () => {
  it("createAsset inserts with the user's id and maps a unique violation to duplicate_asset", async () => {
    const good = fakeClient({ assets: { insert: { data: { id: A } } } });
    expect(await createAsset(good.client, PACKS, U, fii)).toEqual({ ok: true, value: { id: A } });
    expect(good.calls[0]).toMatchObject({ table: "assets", op: "insert", payload: { user_id: U, identifier: "HGLG11" } });
    const dup = fakeClient({ assets: { insert: { error: { code: "23505", message: "duplicate key value violates unique constraint" } } } });
    expect(await createAsset(dup.client, PACKS, U, fii)).toEqual({ ok: false, reason: "duplicate_asset" });
  });

  it("updateAsset refuses an identity change once the asset has transactions, allows name and metadata", async () => {
    const current = { data: { pack_id: "br", instrument_kind: "br.fii", identifier: "HGLG11", native_currency: "BRL" } };
    const locked = fakeClient({ assets: { select: current, update: { data: null } }, transactions: { select: { count: 3 } } });
    expect(await updateAsset(locked.client, PACKS, A, { ...fii, identifier: "OTHER11" })).toEqual({ ok: false, reason: "asset_identity_locked", fields: ["identifier"] });
    expect(locked.calls.some((c) => c.op === "update")).toBe(false);
    const renamed = fakeClient({ assets: { select: current, update: { data: null } }, transactions: { select: { count: 3 } } });
    expect(await updateAsset(renamed.client, PACKS, A, { ...fii, name: "New name" })).toEqual({ ok: true, value: undefined });
    const patch = renamed.calls.find((c) => c.op === "update")!.payload as Record<string, unknown>;
    expect(Object.keys(patch).sort()).toEqual(["metadata", "name"]);
    const missing = fakeClient({ assets: { select: { data: null } } });
    expect(await updateAsset(missing.client, PACKS, A, fii)).toEqual({ ok: false, reason: "not_found" });
  });

  it("deleteAsset refuses with asset_has_transactions, and reports not_found when nothing was deleted", async () => {
    const held = fakeClient({ transactions: { select: { count: 1 } } });
    expect(await deleteAsset(held.client, A)).toEqual({ ok: false, reason: "asset_has_transactions" });
    const free = fakeClient({ transactions: { select: { count: 0 } }, assets: { delete: { data: [{ id: A }] } } });
    expect(await deleteAsset(free.client, A)).toEqual({ ok: true, value: undefined });
    const gone = fakeClient({ transactions: { select: { count: 0 } }, assets: { delete: { data: [] } } });
    expect(await deleteAsset(gone.client, A)).toEqual({ ok: false, reason: "not_found" });
  });
});

describe("transaction, cash-flow, price and base-currency actions", () => {
  const txn = { asset_id: A, trade_date: "2026-02-02", type: "buy", quantity: "100", unit_price: "150", currency: "BRL", fees: "4.90", note: null };

  it("createTransaction validates first, then checks the asset is the user's, then inserts", async () => {
    const bad = fakeClient({});
    expect(await createTransaction(bad.client, U, { ...txn, quantity: "-1" })).toEqual({ ok: false, reason: "invalid_input", fields: ["quantity"] });
    expect(bad.calls).toEqual([]);
    const foreign = fakeClient({ assets: { select: { data: null } } });
    expect(await createTransaction(foreign.client, U, txn)).toEqual({ ok: false, reason: "not_found", fields: ["asset_id"] });
    const good = fakeClient({ assets: { select: { data: { id: A } } }, transactions: { insert: { data: { id: "t1" } } } });
    expect(await createTransaction(good.client, U, txn)).toEqual({ ok: true, value: { id: "t1" } });
    expect(good.calls[1]).toMatchObject({ op: "insert", payload: { user_id: U, quantity: "100", fees: "4.90" } });
  });

  it("update and delete report not_found when RLS returns no row", async () => {
    const none = fakeClient({ assets: { select: { data: { id: A } } }, transactions: { update: { data: [] }, delete: { data: [] } } });
    expect(await updateTransaction(none.client, "t1", txn)).toEqual({ ok: false, reason: "not_found" });
    expect(await deleteTransaction(none.client, "t1")).toEqual({ ok: false, reason: "not_found" });
  });

  it("createCashFlow writes the base currency, never a form value", async () => {
    const c = fakeClient({ cash_flows: { insert: { data: { id: "c1" } } } });
    expect(await createCashFlow(c.client, U, "BRL", { date: "2026-02-02", amount: "1000", currency: "USD" })).toEqual({ ok: true, value: { id: "c1" } });
    expect(c.calls[0].payload).toMatchObject({ user_id: U, currency: "BRL", amount: "1000" });
  });

  it("setManualPrice upserts source_id = 'manual' in the asset's native currency", async () => {
    const c = fakeClient({ assets: { select: { data: { native_currency: "BRL" } } }, prices: { upsert: { data: null } } });
    expect(await setManualPrice(c.client, { asset_id: A, date: "2026-02-20", price: "155.5" })).toEqual({ ok: true, value: undefined });
    expect(c.calls[1]).toMatchObject({ op: "upsert", payload: { asset_id: A, date: "2026-02-20", price: "155.5", currency: "BRL", source_id: "manual" } });
  });

  it("changeBaseCurrency is a no-op on the same value, locked once transactions exist, and resets on confirmation", async () => {
    const same = fakeClient({ user_settings: { select: { data: { base_currency: "BRL" } } } });
    expect(await changeBaseCurrency(same.client, U, { base_currency: "BRL" })).toEqual({ ok: true, value: { reset: false } });
    const locked = fakeClient({ user_settings: { select: { data: { base_currency: "BRL" } } }, transactions: { select: { count: 9 } } });
    expect(await changeBaseCurrency(locked.client, U, { base_currency: "USD" })).toEqual({ ok: false, reason: "base_locked", fields: ["base_currency"] });
    const reset = fakeClient({ user_settings: { select: { data: { base_currency: "BRL" } }, upsert: { data: null } }, transactions: { select: { count: 9 } } });
    expect(await changeBaseCurrency(reset.client, U, { base_currency: "USD", confirmReset: true })).toEqual({ ok: true, value: { reset: true } });
    const fresh = fakeClient({ user_settings: { select: { data: { base_currency: "BRL" } }, upsert: { data: null } }, transactions: { select: { count: 0 } } });
    expect(await changeBaseCurrency(fresh.client, U, { base_currency: "USD" })).toEqual({ ok: true, value: { reset: false } });
  });

  it("reasonFor never reads the message", () => {
    expect(reasonFor({ code: "23505" })).toBe("duplicate_asset");
    expect(reasonFor({ code: "23503" })).toBe("not_found");
    expect(reasonFor({ code: "42501" })).toBe("not_found");
    expect(reasonFor({ code: "23514" })).toBe("invalid_input");
    expect(reasonFor({ code: "XX000" })).toBe("write_failed");
    expect(reasonFor(null)).toBe("write_failed");
  });
});
