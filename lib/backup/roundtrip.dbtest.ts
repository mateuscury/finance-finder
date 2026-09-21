/**
 * Backup round trip against the real database (docs/milestone-2-plan.md
 * Phase 6; specs/SPEC.md US-002): seed the golden portfolio for a throwaway
 * user with ids preserved → export → delete the user and prove every
 * user-scoped table cascaded → create a NEW user (a new uid, so the
 * `user_id` rewrite is what is under test) → restore → export → deep-equal
 * modulo `exported_at`. Then feed the export — already text, already the
 * kernel's row shapes — to `runGolden` and match `expected.json`: the export
 * IS the text-cast read path Milestone 3 will use.
 *
 * Runs under `pnpm test:db` only. Every user-scoped client is on the ANON key
 * and signed in, because the service role bypasses the RLS and `auth.uid()`
 * the two RPCs are built on.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { compareGolden, GoldenFixtureSchema, runGolden, type GoldenFixture } from "@/lib/calc/golden";
import { canonicalBackup, parseBackup, type Backup } from "@/lib/backup";
import {
  assertStackReachable,
  createDbTestClient,
  createThrowawayUser,
  type ThrowawayUserHandle,
} from "@/lib/testing/db";
import { loadGoldenFixture, seedGoldenPortfolio } from "@/lib/testing/golden";
import { asJson, type Db, type UserTable } from "@/lib/supabase/types";

const admin = createDbTestClient();
const users: ThrowawayUserHandle[] = [];
async function newUser(): Promise<ThrowawayUserHandle> {
  const u = await createThrowawayUser(admin);
  users.push(u);
  return u;
}
beforeAll(async () => {
  await assertStackReachable(admin);
});
afterAll(async () => {
  for (const u of users) await u.remove();
});

const { fixture, expected } = loadGoldenFixture();
/** The golden's own counts, so the fixture may grow without editing every assertion. */
const N = {
  assets: fixture.assets.length,
  transactions: fixture.transactions.length,
  cashFlows: fixture.cashFlows.length,
  prices: Object.values(fixture.prices).reduce((n, rows) => n + rows.length, 0),
};

async function exportBackup(client: Db): Promise<Backup> {
  const { data, error } = await client.rpc("export_backup");
  if (error) throw new Error(`export_backup failed (${error.message})`);
  const parsed = parseBackup(data);
  if (!parsed.ok) throw new Error(`export_backup produced an invalid backup: ${parsed.issues.join("; ")}`);
  return parsed.backup;
}

async function countFor(table: UserTable, userId: string): Promise<number> {
  const { count, error } = await admin.from(table).select("*", { head: true, count: "exact" }).eq("user_id", userId);
  if (error) throw new Error(`count ${table} failed (${error.message})`);
  return count ?? -1;
}

async function countPrices(assetIds: string[]): Promise<number> {
  const { count, error } = await admin
    .from("prices")
    .select("*", { head: true, count: "exact" })
    .in("asset_id", assetIds);
  if (error) throw new Error(`count prices failed (${error.message})`);
  return count ?? -1;
}

/** The export as a golden fixture: uuids mapped back to golden ids, series from the checked-in fixture. */
function toGoldenFixture(backup: Backup, goldenIdOf: Map<string, string>): GoldenFixture {
  const identifierOf = new Map(backup.assets.map((a) => [a.id, a.identifier] as const));
  const prices: GoldenFixture["prices"] = {};
  for (const p of backup.prices) {
    const identifier = identifierOf.get(p.asset_id)!;
    (prices[identifier] ??= []).push({ date: p.date, price: p.price, currency: p.currency, sourceId: p.source_id });
  }
  return GoldenFixtureSchema.parse({
    baseCurrency: backup.settings!.base_currency,
    asOf: fixture.asOf,
    valuationDates: fixture.valuationDates,
    assets: backup.assets.map((a) => ({
      id: goldenIdOf.get(a.id),
      instrumentKind: a.instrument_kind,
      identifier: a.identifier,
      nativeCurrency: a.native_currency,
      metadata: a.metadata,
    })),
    transactions: backup.transactions.map((t) => ({
      id: t.id,
      assetId: goldenIdOf.get(t.asset_id),
      tradeDate: t.trade_date,
      type: t.type,
      quantity: t.quantity,
      unitPrice: t.unit_price,
      currency: t.currency,
      fees: t.fees,
      fxRate: t.fx_rate,
    })),
    cashFlows: backup.cash_flows.map((f) => ({ id: f.id, date: f.date, amount: f.amount, currency: f.currency })),
    prices,
    series: fixture.series,
  });
}

const modulo = (b: Backup) => ({ ...canonicalBackup(b), exported_at: "" });

describe("export → delete → restore → export", () => {
  it("is equivalent modulo exported_at, and the kernel reproduces the golden portfolio from the restored rows", async () => {
    const first = await newUser();
    const { uuidOf, goldenIdOf } = await seedGoldenPortfolio(admin, first.userId, fixture);

    const exportA = await exportBackup(await first.signIn());
    expect(exportA.assets).toHaveLength(N.assets);
    expect(exportA.transactions).toHaveLength(N.transactions);
    expect(exportA.cash_flows).toHaveLength(N.cashFlows);
    expect(exportA.prices).toHaveLength(N.prices);
    // Every price row keeps its provenance (decision 3): the export's source ids are the fixture's.
    expect(exportA.prices.map((p) => p.source_id).sort()).toEqual(
      Object.values(fixture.prices)
        .flatMap((rows) => rows.map((r) => r.sourceId))
        .sort(),
    );
    // Text, never a float, on the way out.
    for (const t of exportA.transactions) expect(typeof t.quantity).toBe("string");
    expect(JSON.stringify(exportA)).not.toContain("user_id");

    await first.remove();
    for (const table of ["user_settings", "assets", "transactions", "cash_flows"] as const) {
      expect(await countFor(table, first.userId), `${table} did not cascade`).toBe(0);
    }
    expect(await countPrices([...uuidOf.values()])).toBe(0);

    const second = await newUser();
    const clientB = await second.signIn();
    const restored = await clientB.rpc("restore_backup", { payload: asJson(exportA) });
    expect(restored.error).toBeNull();
    expect(restored.data).toEqual({
      assets: N.assets,
      transactions: N.transactions,
      cash_flows: N.cashFlows,
      prices: N.prices,
    });
    // Ids preserved, ownership rewritten.
    expect(await countFor("assets", second.userId)).toBe(N.assets);
    expect(await countFor("assets", first.userId)).toBe(0);

    const exportB = await exportBackup(clientB);
    expect(modulo(exportB)).toEqual(modulo(exportA));

    const golden = toGoldenFixture(exportB, goldenIdOf);
    const mismatches = compareGolden(runGolden(golden, PACKS), expected);
    expect(
      mismatches,
      mismatches
        .map((m) => `${m.path}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`)
        .join("\n"),
    ).toEqual([]);

    // Refusal: the account is no longer empty.
    const again = await clientB.rpc("restore_backup", { payload: asJson(exportA) });
    expect(again.error?.message).toMatch(/restore_refused: account_not_empty/);
    expect(await countFor("assets", second.userId)).toBe(N.assets);
  });

  it("refuses a file that names another user's asset ids, and writes nothing", async () => {
    const owner = await newUser();
    const { uuidOf } = await seedGoldenPortfolio(admin, owner.userId, fixture);
    const theirs = await exportBackup(await owner.signIn());

    const intruder = await newUser();
    const client = await intruder.signIn();

    // Transactions and prices point at assets that are not in the file's own set.
    const foreign = { ...theirs, assets: [] };
    const r1 = await client.rpc("restore_backup", { payload: asJson(foreign) });
    expect(r1.error?.message).toMatch(/restore_refused: foreign_asset_reference/);

    // The file's own asset rows carry ids that already exist — for the other user.
    const conflict = { ...theirs, transactions: [], cash_flows: [], prices: [] };
    const r2 = await client.rpc("restore_backup", { payload: asJson(conflict) });
    expect(r2.error?.message).toMatch(/restore_refused: asset_id_conflict/);

    // A version this build does not know.
    const future = { ...theirs, version: 2 };
    const r3 = await client.rpc("restore_backup", { payload: asJson(future) });
    expect(r3.error?.message).toMatch(/restore_refused: unsupported_version/);

    for (const table of ["user_settings", "assets", "transactions", "cash_flows"] as const) {
      expect(await countFor(table, intruder.userId), `${table} was written`).toBe(0);
    }
    // The owner's rows are untouched, including the prices the intruder named.
    expect(await countPrices([...uuidOf.values()])).toBe(N.prices);
    expect(await countFor("assets", owner.userId)).toBe(N.assets);
  });

  it("the service role cannot call either RPC: an export or a restore is always a user's own act", async () => {
    expect((await admin.rpc("export_backup")).error?.message).toMatch(/permission denied/i);
    expect((await admin.rpc("restore_backup", { payload: { version: 1 } })).error?.message).toMatch(
      /permission denied/i,
    );
  });
  it("refuses a row the database itself rejects with the fixed reason invalid_rows, writing nothing (D-16)", async () => {
    const owner = await newUser();
    await seedGoldenPortfolio(admin, owner.userId, fixture);
    const theirs = await exportBackup(await owner.signIn());
    // The file's asset ids must be free, as after a real loss of the account.
    await owner.remove();

    const fresh = await newUser();
    const client = await fresh.signIn();
    // A negative unit price violates the transactions check constraint; before
    // the hardening this surfaced as the raw Postgres error text.
    const broken = {
      ...theirs,
      transactions: theirs.transactions.map((x, i) => (i === 0 ? { ...x, unit_price: "-1" } : x)),
    };
    const res = await client.rpc("restore_backup", { payload: asJson(broken) });
    expect(res.error?.message).toMatch(/restore_refused: invalid_rows/);
    expect(res.error?.message).not.toMatch(/violates|constraint/i);
    for (const table of ["assets", "transactions", "cash_flows"] as const) {
      expect(await countFor(table, fresh.userId), `${table} was written`).toBe(0);
    }
  });

  it("serialises two concurrent restores into one empty account: exactly one wins (D-17)", async () => {
    const owner = await newUser();
    await seedGoldenPortfolio(admin, owner.userId, fixture);
    const theirs = await exportBackup(await owner.signIn());
    await owner.remove();

    const fresh = await newUser();
    const [a, b] = await Promise.all([fresh.signIn(), fresh.signIn()]);
    const [ra, rb] = await Promise.all([
      a.rpc("restore_backup", { payload: asJson(theirs) }),
      b.rpc("restore_backup", { payload: asJson(theirs) }),
    ]);
    const outcomes = [ra, rb].map((r) => (r.error ? r.error.message : "ok"));
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
    expect(outcomes.find((o) => o !== "ok")).toMatch(/restore_refused: account_not_empty/);
    expect(await countFor("assets", fresh.userId)).toBe(N.assets);
    expect(await countFor("transactions", fresh.userId)).toBe(N.transactions);
  });
});
