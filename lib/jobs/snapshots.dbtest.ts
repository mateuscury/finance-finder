/**
 * The snapshot invariant and the snapshot job against the real database
 * (specs/SPEC.md US-006 AC-006.2, AC-006.6; decisions 20–22).
 *
 * Runs under `pnpm test:db` only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { KernelDecimal } from "@/lib/calc/decimal";
import { assertStackReachable, createDbTestClient, createThrowawayUser, type ThrowawayUserHandle } from "@/lib/testing/db";
import { loadGoldenFixture, removeGoldenSeries, seedGoldenPortfolio } from "@/lib/testing/golden";
import { runSnapshots } from "./snapshots";
import { createSnapshotStore } from "./snapshots-store";

const admin = createDbTestClient();
const users: ThrowawayUserHandle[] = [];
async function newUser(): Promise<ThrowawayUserHandle> {
  const u = await createThrowawayUser(admin);
  users.push(u);
  return u;
}
const { fixture, expected } = loadGoldenFixture();
beforeAll(async () => {
  await assertStackReachable(admin);
});
afterAll(async () => {
  for (const u of users) await u.remove();
  await removeGoldenSeries(admin, fixture);
});

async function snapshotDates(userId: string): Promise<string[]> {
  const { data, error } = await admin.from("portfolio_snapshots").select("date").eq("user_id", userId).order("date");
  if (error) throw new Error(error.message);
  return [...new Set((data ?? []).map((r) => r.date as string))];
}

async function fakeSnapshots(userId: string, assetId: string, dates: string[]): Promise<void> {
  const { error } = await admin.from("portfolio_snapshots").insert(
    dates.map((date) => ({ user_id: userId, asset_id: assetId, date, quantity: "1", price_native: "1", base_currency: "BRL", market_value_base: "1", price_date: date, status: "ok" })),
  );
  if (error) throw new Error(`seed snapshots: ${error.message}`);
}

const DATES = ["2026-02-10", "2026-02-12", "2026-02-13", "2026-02-18", "2026-02-19", "2026-02-27"];

describe("invalidate_snapshots triggers", () => {
  it("a transaction write drops the user's rows from its date forward, and nothing of another user's", async () => {
    const a = await newUser();
    const b = await newUser();
    const seedA = await seedGoldenPortfolio(admin, a.userId, fixture);
    const seedB = await seedGoldenPortfolio(admin, b.userId, fixture);
    const fiiA = seedA.uuidOf.get("fii")!;
    const fiiB = seedB.uuidOf.get("fii")!;
    await fakeSnapshots(a.userId, fiiA, DATES);
    await fakeSnapshots(b.userId, fiiB, DATES);

    // INSERT dated 02-13 → A keeps 02-10 and 02-12 only.
    const clientA = await a.signIn();
    const ins = await clientA.from("transactions").insert({ user_id: a.userId, asset_id: fiiA, trade_date: "2026-02-13", type: "buy", quantity: "1", unit_price: "150", currency: "BRL", fees: "0" }).select("id").single();
    expect(ins.error).toBeNull();
    expect(await snapshotDates(a.userId)).toEqual(["2026-02-10", "2026-02-12"]);
    expect(await snapshotDates(b.userId)).toEqual(DATES);

    // UPDATE moving that transaction EARLIER, to 02-11 → least(old, new) = 02-11 → only 02-10 survives.
    await fakeSnapshots(a.userId, fiiA, DATES.slice(2));
    const upd = await clientA.from("transactions").update({ trade_date: "2026-02-11" }).eq("id", ins.data!.id);
    expect(upd.error).toBeNull();
    expect(await snapshotDates(a.userId)).toEqual(["2026-02-10"]);

    // DELETE → from the deleted row's date.
    await fakeSnapshots(a.userId, fiiA, DATES.slice(1));
    const del = await clientA.from("transactions").delete().eq("id", ins.data!.id);
    expect(del.error).toBeNull();
    expect(await snapshotDates(a.userId)).toEqual(["2026-02-10"]);
    expect(await snapshotDates(b.userId)).toEqual(DATES);
  });

  it("a price write (manual from the client, or a pack price from the service role) drops rows from its date forward", async () => {
    const a = await newUser();
    const seed = await seedGoldenPortfolio(admin, a.userId, fixture);
    const fii = seed.uuidOf.get("fii")!;
    await fakeSnapshots(a.userId, fii, DATES);

    const clientA = await a.signIn();
    const manual = await clientA.from("prices").insert({ asset_id: fii, date: "2026-02-20", price: "155.5", currency: "BRL", source_id: "manual" });
    expect(manual.error).toBeNull();
    expect(await snapshotDates(a.userId)).toEqual(["2026-02-10", "2026-02-12", "2026-02-13", "2026-02-18", "2026-02-19"]);

    // The nightly cron writes with the service role and a pack source id: same rule.
    await fakeSnapshots(a.userId, fii, ["2026-02-20", "2026-02-27"]);
    const pack = await admin.from("prices").update({ price: "153.9" }).eq("asset_id", fii).eq("date", "2026-02-13");
    expect(pack.error).toBeNull();
    expect(await snapshotDates(a.userId)).toEqual(["2026-02-10", "2026-02-12"]);
  });

  it("a base currency change drops every row; a theme change drops none", async () => {
    const a = await newUser();
    const seed = await seedGoldenPortfolio(admin, a.userId, fixture);
    await fakeSnapshots(a.userId, seed.uuidOf.get("fii")!, DATES);
    const clientA = await a.signIn();
    expect((await clientA.from("user_settings").update({ theme: "dark" }).eq("user_id", a.userId)).error).toBeNull();
    expect(await snapshotDates(a.userId)).toEqual(DATES);
    expect((await clientA.from("user_settings").update({ base_currency: "USD" }).eq("user_id", a.userId)).error).toBeNull();
    expect(await snapshotDates(a.userId)).toEqual([]);
  });

  it("a client cannot write snapshots directly, even its own", async () => {
    const a = await newUser();
    const seed = await seedGoldenPortfolio(admin, a.userId, fixture);
    const clientA = await a.signIn();
    const res = await clientA.from("portfolio_snapshots").insert({ user_id: a.userId, asset_id: seed.uuidOf.get("fii")!, date: "2026-02-10", quantity: "1", price_native: "1", base_currency: "BRL", market_value_base: "1" });
    expect(res.error).not.toBeNull();
  });
});

describe("runSnapshots over the golden portfolio", () => {
  it("builds every BR business day from the first trade, reproduces the golden totals, resumes, and rebuilds after invalidation", async () => {
    const a = await newUser();
    const seed = await seedGoldenPortfolio(admin, a.userId, fixture, { series: true });
    const store = createSnapshotStore(admin, PACKS);
    const at = (iso: string) => () => new Date(`${iso}T23:00:00Z`);

    const first = await runSnapshots({ scope: { kind: "users", userIds: [a.userId] }, budgetMs: 50_000, reserveMs: 0, now: at("2026-02-27"), store });
    expect(first.users).toHaveLength(1);
    expect(first.users[0]).toMatchObject({ status: "complete", from: "2026-01-15", to: "2026-02-27", daysBuilt: 30 });

    const { data, error } = await admin
      .from("portfolio_snapshots")
      .select("asset_id,date,market_value_base::text,status,price_date,fx_date,fx_rate::text,carried_forward")
      .eq("user_id", a.userId)
      .order("date")
      .order("asset_id");
    expect(error).toBeNull();
    const rows = (data ?? []) as Array<{ asset_id: string; date: string; market_value_base: string; status: string; price_date: string; fx_date: string | null; fx_rate: string | null; carried_forward: boolean }>;

    const valuations = expected.valuations as Record<string, string>;
    for (const [date, total] of Object.entries(valuations)) {
      const sum = rows.filter((r) => r.date === date && r.status !== "stale").reduce((s, r) => s.plus(r.market_value_base), new KernelDecimal(0));
      expect(sum.minus(total).abs().lt("1e-8"), `${date}: ${sum.toFixed()} vs ${total}`).toBe(true);
    }
    const fii19 = rows.find((r) => r.date === "2026-02-19" && r.asset_id === seed.uuidOf.get("fii"))!;
    expect(fii19).toMatchObject({ status: "carried_forward", price_date: "2026-02-18", carried_forward: true, fx_date: null, fx_rate: null });
    expect(rows.some((r) => r.date === "2026-02-16")).toBe(false); // Carnival

    // Caught up: nothing to do.
    const again = await runSnapshots({ scope: { kind: "users", userIds: [a.userId] }, budgetMs: 50_000, reserveMs: 0, now: at("2026-02-27"), store });
    expect(again.users[0].status).toBe("nothing_to_do");

    // A backdated transaction: the trigger drops rows from 02-12 on, the job rebuilds them.
    const backdated = await admin.from("transactions").insert({ id: randomUUID(), user_id: a.userId, asset_id: seed.uuidOf.get("fii")!, trade_date: "2026-02-12", type: "buy", quantity: "10", unit_price: "152", currency: "BRL", fees: "0" });
    expect(backdated.error).toBeNull();
    expect((await snapshotDates(a.userId)).every((d) => d < "2026-02-12")).toBe(true);
    const rebuilt = await runSnapshots({ scope: { kind: "users", userIds: [a.userId] }, budgetMs: 50_000, reserveMs: 0, now: at("2026-02-27"), store });
    expect(rebuilt.users[0]).toMatchObject({ status: "complete", from: "2026-02-12", to: "2026-02-27" });
    const fii27 = await admin.from("portfolio_snapshots").select("quantity::text").eq("user_id", a.userId).eq("asset_id", seed.uuidOf.get("fii")!).eq("date", "2026-02-27").single();
    expect((fii27.data as { quantity: string }).quantity).toBe("130.0000000000");
  });
});
