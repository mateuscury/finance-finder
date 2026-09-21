/**
 * The live read path under RLS (specs/SPEC.md US-004 AC-004.7, US-006
 * AC-006.4): the golden portfolio is seeded for a throwaway user, read back
 * through `readLedger` AS THAT USER on the anon key, and reproduced by the
 * kernel to 1e-8 — the same proof the backup round trip gives, now through
 * the reads every page and the snapshot job will use. A second user reads
 * nothing of it.
 *
 * Runs under `pnpm test:db` only.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { compareGolden, GoldenFixtureSchema, runGolden, type GoldenFixture } from "@/lib/calc/golden";
import { valuePortfolio } from "@/lib/calc/portfolio";
import { assertStackReachable, createDbTestClient, createThrowawayUser, type ThrowawayUserHandle } from "@/lib/testing/db";
import { loadGoldenFixture, removeGoldenSeries, seedGoldenPortfolio } from "@/lib/testing/golden";
import { countLedger, listAssets, listCashFlows, listTransactions } from "./queries";
import { readLedger, toPortfolioInput } from "./rows";

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
  await removeGoldenSeries(admin, fixture);
});

const { fixture, expected } = loadGoldenFixture();
/** The golden's own counts, so the fixture may grow without editing every assertion. */
const N = {
  assets: fixture.assets.length,
  transactions: fixture.transactions.length,
  cashFlows: fixture.cashFlows.length,
  prices: Object.values(fixture.prices).reduce((n, rows) => n + rows.length, 0),
};

/** The read, re-keyed by golden asset id so it can be compared with expected.json. */
function toGolden(read: Awaited<ReturnType<typeof readLedger>>, goldenIdOf: Map<string, string>): GoldenFixture {
  const identifierOf = new Map(read.assets.map((a) => [a.id, a.identifier] as const));
  const prices: GoldenFixture["prices"] = {};
  for (const p of read.prices) (prices[identifierOf.get(p.assetId)!] ??= []).push({ date: p.date, price: p.price, currency: p.currency, sourceId: p.sourceId });
  const series: GoldenFixture["series"] = {};
  for (const s of read.series) (series[s.seriesId] ??= []).push({ date: s.date, value: s.value, tenorDays: s.tenorDays });
  return GoldenFixtureSchema.parse({
    baseCurrency: read.settings.base_currency,
    asOf: fixture.asOf,
    valuationDates: fixture.valuationDates,
    assets: read.assets.map((a) => ({ id: goldenIdOf.get(a.id), instrumentKind: a.instrumentKind.id, identifier: a.identifier, nativeCurrency: a.nativeCurrency, metadata: a.metadata })),
    transactions: read.transactions.map((t) => ({ ...t, assetId: goldenIdOf.get(t.assetId) })),
    cashFlows: read.cashFlows,
    prices,
    series,
  });
}

describe("readLedger under RLS", () => {
  it("reads the golden portfolio back as text rows and the kernel reproduces expected.json", async () => {
    const owner = await newUser();
    const { goldenIdOf } = await seedGoldenPortfolio(admin, owner.userId, fixture, { series: true });
    const client: SupabaseClient = await owner.signIn();

    const read = await readLedger(client, PACKS);
    expect(read.assets).toHaveLength(N.assets);
    expect(read.unresolved).toEqual([]);
    expect(read.transactions).toHaveLength(N.transactions);
    expect(read.cashFlows).toHaveLength(N.cashFlows);
    expect(read.prices).toHaveLength(N.prices);
    expect(read.series.filter((s) => s.seriesId === "br.cdi").length).toBeGreaterThanOrEqual(39);
    expect(read.packs.map((p) => p.id).sort()).toEqual(["br", "global"]);
    for (const t of read.transactions) expect(typeof t.quantity).toBe("string");

    // The kernel on the live read path, straight from PortfolioInput…
    const input = toPortfolioInput(read);
    const valued = valuePortfolio(input, fixture.asOf);
    expect(valued.totalBase.toString().slice(0, 12)).toBe(String((expected.valuation as { total: string }).total).slice(0, 12));
    // …and through the golden runner, to 1e-8.
    const mismatches = compareGolden(runGolden(toGolden(read, goldenIdOf), PACKS), expected);
    expect(mismatches, mismatches.map((m) => `${m.path}: expected ${JSON.stringify(m.expected)}, got ${JSON.stringify(m.actual)}`).join("\n")).toEqual([]);
  });

  it("the page queries see the same rows; another user sees nothing", async () => {
    const owner = await newUser();
    await seedGoldenPortfolio(admin, owner.userId, fixture, { series: true });
    const client = await owner.signIn();

    const assets = await listAssets(client, PACKS);
    expect(assets).toHaveLength(N.assets);
    const fii = assets.find((a) => a.identifier === "HGLG11")!;
    expect(fii.latest).toEqual({ date: "2026-02-27", price: "156.2000000000", currency: "BRL", sourceId: "br.brapi" });
    expect(fii.kindLabel).toBe("Fundo Imobiliário (FII)");
    const cdb = assets.find((a) => a.identifier === "cdb-banco-x-2028")!;
    expect(cdb.valuation).toBe("accrual");
    expect(cdb.latest).toBeNull();

    const txns = await listTransactions(client, 1);
    expect(txns.total).toBe(N.transactions);
    expect(txns.rows[0].trade_date).toBe("2026-02-18");
    expect(txns.rows[0].identifier).toBe("HGLG11");
    expect((await listCashFlows(client, 1)).total).toBe(N.cashFlows);
    expect(await countLedger(client)).toEqual({ assets: N.assets, transactions: N.transactions, cashFlows: N.cashFlows });

    const stranger = await (await newUser()).signIn();
    expect(await countLedger(stranger)).toEqual({ assets: 0, transactions: 0, cashFlows: 0 });
    expect(await listAssets(stranger, PACKS)).toEqual([]);
    const theirs = await readLedger(stranger, PACKS);
    expect(theirs.assets).toEqual([]);
    expect(theirs.prices).toEqual([]);
  });
});
