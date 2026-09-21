import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { PAGE_SIZE } from "@/lib/supabase/paginate";
import { fakeClient } from "@/lib/testing/fake-client";
import { createSnapshotStore, type SnapshotRow } from "./snapshots-store";

describe("createSnapshotStore", () => {
  it("listUsers reads the markers view in one page and orders nulls first, then date, then id — whatever order the rows arrive in", async () => {
    const { client, calls } = fakeClient({
      snapshot_markers: {
        select: {
          data: [
            { user_id: "u3", last_snapshot_date: "2026-02-27", earliest_trade_date: "2026-01-15" },
            { user_id: "u1", last_snapshot_date: null, earliest_trade_date: "2026-02-02" },
            { user_id: "u2", last_snapshot_date: "2026-02-12", earliest_trade_date: "2026-01-15" },
            { user_id: "u0", last_snapshot_date: null, earliest_trade_date: null },
          ],
        },
      },
    });
    const store = createSnapshotStore(client, PACKS);
    const users = await store.listUsers({ kind: "users", userIds: ["u0", "u1", "u2", "u3"] });
    expect(users.map((u) => u.userId)).toEqual(["u0", "u1", "u2", "u3"]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      table: "snapshot_markers",
      filters: [["user_id", "in", ["u0", "u1", "u2", "u3"]]],
    });
  });

  it("writeDay upserts in chunks of PAGE_SIZE and stops at the first failure", async () => {
    const row = (i: number): SnapshotRow => ({
      user_id: "u1",
      asset_id: `a${i}`,
      date: "2026-02-27",
      quantity: "1",
      price_native: "1",
      price_date: "2026-02-27",
      fx_rate: null,
      fx_date: null,
      base_currency: "BRL",
      market_value_base: "1",
      carried_forward: false,
      status: "ok",
    });
    const rows = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => row(i));
    const ok = fakeClient({ portfolio_snapshots: { upsert: { data: null } } });
    await createSnapshotStore(ok.client, PACKS).writeDay("u1", "2026-02-27", rows);
    expect(ok.calls.map((c) => (c.payload as unknown[]).length)).toEqual([PAGE_SIZE, 1]);

    const failing = fakeClient({ portfolio_snapshots: { upsert: [{ error: { code: "23503" } }, { data: null }] } });
    await expect(createSnapshotStore(failing.client, PACKS).writeDay("u1", "2026-02-27", rows)).rejects.toThrow(
      /snapshots: write \(23503\)/,
    );
    expect(failing.calls).toHaveLength(1);

    const empty = fakeClient({});
    await createSnapshotStore(empty.client, PACKS).writeDay("u1", "2026-02-27", []);
    expect(empty.calls).toHaveLength(0);
  });
});
