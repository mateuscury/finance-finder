/**
 * The status strip's reader against the real database (SPEC §9.2): the
 * unpriced count through the latest-price view and the marker through the
 * markers view, both under the user's own RLS. Runs under `pnpm test:db`.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import {
  assertStackReachable,
  createDbTestClient,
  createThrowawayUser,
  type ThrowawayUserHandle,
} from "@/lib/testing/db";
import { loadGoldenFixture, removeGoldenSeries, seedGoldenPortfolio } from "@/lib/testing/golden";
import { readStatus } from "./status";

const admin = createDbTestClient();
const users: ThrowawayUserHandle[] = [];
const { fixture } = loadGoldenFixture();
beforeAll(async () => {
  await assertStackReachable(admin);
});
afterAll(async () => {
  for (const u of users) await u.remove();
  await removeGoldenSeries(admin, fixture);
});

describe("readStatus", () => {
  it("reports the golden ledger's unpriced market assets, its rebuild gap and the export nudge — for its owner only", async () => {
    const owner = await createThrowawayUser(admin);
    users.push(owner);
    const { uuidOf } = await seedGoldenPortfolio(admin, owner.userId, fixture);
    // Take the FII's prices away: it becomes unpriced; the stock and the TD keep theirs.
    await admin.from("prices").delete().eq("asset_id", uuidOf.get("fii")!);
    const client = await owner.signIn();
    const status = await readStatus(client, PACKS, { BRAPI_TOKEN: "x" }, "2026-03-02");
    expect(status.unpricedAssets).toBe(1);
    expect(status.rebuild).toEqual({ from: "2026-01-15", through: null, target: "2026-03-02" });
    expect(status.exportNudge).toEqual({ lastExportAt: null });
    expect(status.disabledSources).toEqual([]);

    const stranger = await createThrowawayUser(admin);
    users.push(stranger);
    const theirs = await readStatus(await stranger.signIn(), PACKS, {}, "2026-03-02");
    expect(theirs).toEqual({ unpricedAssets: 0, rebuild: null, disabledSources: [], exportNudge: null });
  });
});
