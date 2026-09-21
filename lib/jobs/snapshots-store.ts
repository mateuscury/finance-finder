/**
 * Supabase-backed `SnapshotStore` — service role, the only writer of
 * `portfolio_snapshots` (ARCHITECTURE §4.3). Reads go through
 * `lib/ledger/rows.ts` scoped by user id, so every numeric is text.
 */
import type { Db } from "@/lib/supabase/types";
import type { IsoDate, MarketPack } from "@/packs/types";
import { readLedger } from "@/lib/ledger/rows";
import { readAll } from "@/lib/supabase/paginate";
import type { SnapshotStore, SnapshotUser } from "./snapshots";

export function createSnapshotStore(client: Db, registry: readonly MarketPack[]): SnapshotStore {
  return {
    async listUsers(scope) {
      const settings = await readAll<{ user_id: string }>((from, to) => {
        let q = client.from("user_settings").select("user_id");
        if (scope.kind === "users") q = q.in("user_id", scope.userIds);
        return q.order("user_id").range(from, to);
      });
      const users: SnapshotUser[] = [];
      for (const { user_id } of settings) {
        const [last, first] = await Promise.all([
          client
            .from("portfolio_snapshots")
            .select("date")
            .eq("user_id", user_id)
            .order("date", { ascending: false })
            .limit(1)
            .maybeSingle(),
          client
            .from("transactions")
            .select("trade_date")
            .eq("user_id", user_id)
            .order("trade_date", { ascending: true })
            .limit(1)
            .maybeSingle(),
        ]);
        if (last.error) throw new Error(`snapshots: last date (${last.error.code ?? "unknown"})`);
        if (first.error) throw new Error(`snapshots: first trade (${first.error.code ?? "unknown"})`);
        users.push({
          userId: user_id,
          lastSnapshotDate: last.data?.date ?? null,
          earliestTradeDate: first.data?.trade_date ?? null,
        });
      }
      // Least-recently-snapshotted first (nulls first), then by id: a long
      // rebuild for one user cannot starve the others forever.
      return users.sort((a, b) => {
        if (a.lastSnapshotDate === null && b.lastSnapshotDate !== null) return -1;
        if (b.lastSnapshotDate === null && a.lastSnapshotDate !== null) return 1;
        if (a.lastSnapshotDate !== null && b.lastSnapshotDate !== null && a.lastSnapshotDate !== b.lastSnapshotDate)
          return a.lastSnapshotDate < b.lastSnapshotDate ? -1 : 1;
        return a.userId < b.userId ? -1 : 1;
      });
    },

    readLedger(userId: string, seriesFrom: IsoDate) {
      return readLedger(client, registry, { userId, seriesFrom });
    },

    async writeDay(_userId, _date, rows) {
      if (rows.length === 0) return;
      // One upsert statement is one transaction: a day is written whole or not at all.
      const { error } = await client.from("portfolio_snapshots").upsert(rows, { onConflict: "user_id,asset_id,date" });
      if (error) throw new Error(`snapshots: write (${error.code ?? "unknown"})`);
    },
  };
}
