/**
 * Supabase-backed `SnapshotStore` — service role, the only writer of
 * `portfolio_snapshots` (ARCHITECTURE §4.3). Reads go through
 * `lib/ledger/rows.ts` scoped by user id, so every numeric is text.
 */
import type { IsoDate, MarketPack } from "@/packs/types";
import { readLedger } from "@/lib/ledger/rows";
import { PAGE_SIZE, readAll } from "@/lib/supabase/paginate";
import type { Db } from "@/lib/supabase/types";
import { byString, nullsFirst } from "@/lib/util/order";
import type { SnapshotRow, SnapshotStore, SnapshotUser } from "./snapshots";

interface MarkerRow {
  user_id: string;
  last_snapshot_date: string | null;
  earliest_trade_date: string | null;
}

export function createSnapshotStore(client: Db, registry: readonly MarketPack[]): SnapshotStore {
  return {
    async listUsers(scope) {
      // One paginated read of the `snapshot_markers` view (Milestone 4
      // D-11) instead of two limit(1) reads per user. Ordered in SQL —
      // least-recently-snapshotted first, nulls first, then by id — and
      // sorted again in memory so the contract holds for any store.
      const rows = await readAll<MarkerRow>((from, to) => {
        let q = client.from("snapshot_markers").select("user_id,last_snapshot_date,earliest_trade_date");
        if (scope.kind === "users") q = q.in("user_id", scope.userIds);
        return (
          q
            .order("last_snapshot_date", { ascending: true, nullsFirst: true })
            .order("user_id")
            .range(from, to)
            // A generated view type marks every column nullable; `user_id`
            // comes from user_settings' NOT NULL primary key.
            .overrideTypes<MarkerRow[]>()
        );
      });
      const users: SnapshotUser[] = rows.map((r) => ({
        userId: r.user_id,
        lastSnapshotDate: r.last_snapshot_date,
        earliestTradeDate: r.earliest_trade_date,
      }));
      return users.sort(
        nullsFirst(
          (u) => u.lastSnapshotDate,
          byString((u) => u.userId),
        ),
      );
    },

    readLedger(userId: string, seriesFrom: IsoDate, pricesFrom: IsoDate) {
      return readLedger(client, registry, { userId, seriesFrom, pricesFrom });
    },

    async writeDay(_userId, _date, rows) {
      if (rows.length === 0) return;
      // Upserted in chunks so a thousand-asset day never exceeds a request
      // body (Milestone 4 D-18). A crash between chunks leaves a partial
      // day; the marker is `max(date)`, so the next run rebuilds that day
      // whole, and the upsert is idempotent — nothing is double-counted.
      for (let i = 0; i < rows.length; i += PAGE_SIZE) {
        const { error } = await client
          .from("portfolio_snapshots")
          .upsert(rows.slice(i, i + PAGE_SIZE), { onConflict: "user_id,asset_id,date" });
        if (error) throw new Error(`snapshots: write (${error.code ?? "unknown"})`);
      }
    },
  };
}

export type { SnapshotRow };
