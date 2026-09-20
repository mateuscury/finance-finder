/**
 * Ledger writes against the real database (specs/SPEC.md US-004 AC-004.3,
 * AC-004.6, AC-004.7; US-005 AC-005.4): ownership by RLS and the composite
 * keys, identity immutability and delete refusal (decision 27), the base
 * currency lock and reset (decision 26), and manual prices the cron never
 * overwrites.
 *
 * Runs under `pnpm test:db` only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { assertStackReachable, createDbTestClient, createThrowawayUser, type ThrowawayUserHandle } from "@/lib/testing/db";
import { loadGoldenFixture, seedGoldenPortfolio } from "@/lib/testing/golden";
import { createAsset, deleteAsset, updateAsset } from "./assets";
import { createCashFlow } from "./cashFlows";
import { setManualPrice } from "./prices";
import { changeBaseCurrency } from "./settings";
import { createTransaction, deleteTransaction, updateTransaction } from "./transactions";

const admin = createDbTestClient();
const users: ThrowawayUserHandle[] = [];
async function newUser(): Promise<ThrowawayUserHandle> {
  const u = await createThrowawayUser(admin);
  users.push(u);
  return u;
}
const { fixture } = loadGoldenFixture();
beforeAll(async () => {
  await assertStackReachable(admin);
});
afterAll(async () => {
  for (const u of users) await u.remove();
});

const fii = { pack_id: "br", instrument_kind: "br.fii", identifier: "XPLG11", name: "XP Log", native_currency: "BRL", metadata: { fundName: "XP Log" } };
const buy = (assetId: string) => ({ asset_id: assetId, trade_date: "2026-02-02", type: "buy", quantity: "10", unit_price: "100", currency: "BRL", fees: "0", note: null });

describe("ownership", () => {
  it("a second user cannot reference, read, update or delete the first user's rows", async () => {
    const a = await newUser();
    const b = await newUser();
    const clientA = await a.signIn();
    const clientB = await b.signIn();
    const created = await createAsset(clientA, PACKS, a.userId, fii);
    expect(created.ok).toBe(true);
    const assetA = created.ok ? created.value.id : "";
    const txn = await createTransaction(clientA, a.userId, buy(assetA));
    expect(txn.ok).toBe(true);
    const txnA = txn.ok ? txn.value.id : "";

    // B: the asset is not visible, so a transaction against it is not_found — before the FK ever sees it.
    expect(await createTransaction(clientB, b.userId, buy(assetA))).toEqual({ ok: false, reason: "not_found", fields: ["asset_id"] });
    expect(await updateTransaction(clientB, txnA, { ...buy(assetA), quantity: "999" })).toEqual({ ok: false, reason: "not_found", fields: ["asset_id"] });
    expect(await deleteTransaction(clientB, txnA)).toEqual({ ok: false, reason: "not_found" });
    expect(await updateAsset(clientB, PACKS, assetA, { ...fii, name: "stolen" })).toEqual({ ok: false, reason: "not_found" });
    // B sees no transactions for it (RLS), so the count is 0 and the delete matches no row.
    expect(await deleteAsset(clientB, assetA)).toEqual({ ok: false, reason: "not_found" });
    expect(await setManualPrice(clientB, { asset_id: assetA, date: "2026-02-02", price: "1" })).toEqual({ ok: false, reason: "not_found", fields: ["asset_id"] });

    // Even a raw insert naming A's asset with B's user id is refused by the composite FK.
    const raw = await clientB.from("transactions").insert({ user_id: b.userId, asset_id: assetA, trade_date: "2026-02-02", type: "buy", quantity: "1", unit_price: "1", currency: "BRL" });
    expect(raw.error).not.toBeNull();

    // A's rows are untouched.
    const { count } = await admin.from("transactions").select("*", { count: "exact", head: true }).eq("user_id", a.userId);
    expect(count).toBe(1);
    const row = await admin.from("transactions").select("quantity::text").eq("id", txnA).single();
    expect((row.data as { quantity: string }).quantity).toBe("10.0000000000");
  });
});

describe("decision 27 — identity", () => {
  it("identity fields lock once a transaction exists; name and metadata stay editable; delete is refused", async () => {
    const a = await newUser();
    const client = await a.signIn();
    const created = await createAsset(client, PACKS, a.userId, fii);
    const assetId = created.ok ? created.value.id : "";
    // Before any transaction, identity may change.
    expect((await updateAsset(client, PACKS, assetId, { ...fii, identifier: "XPLG12" })).ok).toBe(true);
    expect((await createTransaction(client, a.userId, buy(assetId))).ok).toBe(true);
    expect(await updateAsset(client, PACKS, assetId, { ...fii, identifier: "XPLG13" })).toEqual({ ok: false, reason: "asset_identity_locked", fields: ["identifier"] });
    expect(await updateAsset(client, PACKS, assetId, { ...fii, identifier: "XPLG12", name: "Renamed", metadata: { fundName: "Renamed" } })).toEqual({ ok: true, value: undefined });
    const { data } = await client.from("assets").select("identifier,name").eq("id", assetId).single();
    expect(data).toEqual({ identifier: "XPLG12", name: "Renamed" });
    expect(await deleteAsset(client, assetId)).toEqual({ ok: false, reason: "asset_has_transactions" });
    // A duplicate identity for the same user is refused with a fixed reason.
    expect(await createAsset(client, PACKS, a.userId, { ...fii, identifier: "XPLG12" })).toEqual({ ok: false, reason: "duplicate_asset" });
  });
});

describe("decision 26 — base currency", () => {
  it("locks at the first transaction; the confirmed reset changes it and the trigger drops every snapshot", async () => {
    const a = await newUser();
    const seed = await seedGoldenPortfolio(admin, a.userId, fixture);
    const client = await a.signIn();
    await admin.from("portfolio_snapshots").insert([{ user_id: a.userId, asset_id: seed.uuidOf.get("fii")!, date: "2026-02-10", quantity: "1", price_native: "1", base_currency: "BRL", market_value_base: "1", status: "ok" }]);
    expect(await changeBaseCurrency(client, a.userId, { base_currency: "USD" })).toEqual({ ok: false, reason: "base_locked", fields: ["base_currency"] });
    expect(await changeBaseCurrency(client, a.userId, { base_currency: "USD", confirmReset: true })).toEqual({ ok: true, value: { reset: true } });
    const { data } = await client.from("user_settings").select("base_currency").eq("user_id", a.userId).single();
    expect(data).toEqual({ base_currency: "USD" });
    const { count } = await admin.from("portfolio_snapshots").select("*", { count: "exact", head: true }).eq("user_id", a.userId);
    expect(count).toBe(0);
  });
});

describe("manual prices and cash flows", () => {
  it("a manual price is written with source_id 'manual', can overwrite a pack price, and cash flows carry the base currency", async () => {
    const a = await newUser();
    const seed = await seedGoldenPortfolio(admin, a.userId, fixture);
    const client = await a.signIn();
    const fiiId = seed.uuidOf.get("fii")!;
    expect(await setManualPrice(client, { asset_id: fiiId, date: "2026-02-13", price: "154.00" })).toEqual({ ok: true, value: undefined });
    const { data } = await admin.from("prices").select("price::text,source_id").eq("asset_id", fiiId).eq("date", "2026-02-13").single();
    expect(data).toEqual({ price: "154.0000000000", source_id: "manual" });
    // The user cannot write a pack provenance from the client.
    const forged = await client.from("prices").insert({ asset_id: fiiId, date: "2026-03-01", price: "1", currency: "BRL", source_id: "br.brapi" });
    expect(forged.error).not.toBeNull();
    const flow = await createCashFlow(client, a.userId, "BRL", { date: "2026-03-01", amount: "-100.5" });
    expect(flow.ok).toBe(true);
    const row = await admin.from("cash_flows").select("amount::text,currency").eq("id", flow.ok ? flow.value.id : "").single();
    expect(row.data).toEqual({ amount: "-100.5000000000", currency: "BRL" });
  });
});
