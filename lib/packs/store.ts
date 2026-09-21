/**
 * Supabase-backed `IngestStore` (plan §3.1, §3.3).
 *
 * The scheduler talks to the narrow interface in ingest.ts; this is the only
 * place that knows about PostgREST. Every collection read is PAGINATED through
 * `lib/supabase/paginate.ts`: PostgREST caps a response at `api.max_rows`
 * (1,000 by default), and treating that cap as a total silently drops every
 * row past it.
 */
import { asJson, type Db } from "@/lib/supabase/types";
import type {
  AssetRow,
  CommitCounts,
  CommitPayload,
  CursorRow,
  IngestScope,
  IngestStore,
  WatermarkRow,
} from "./ingest";
import type { IsoDate } from "@/packs/types";
import { PAGE_SIZE as PAGE, readAll } from "@/lib/supabase/paginate";

export function createIngestStore(client: Db): IngestStore {
  return {
    async listEnabledPacks(offset, limit) {
      const { data, error } = await client
        .from("user_settings")
        .select("enabled_packs")
        .range(offset, offset + limit - 1);
      if (error) throw new Error(`store: ${error.message}`);
      return (data ?? []).map((row) => (row.enabled_packs as string[] | null) ?? []);
    },

    async listCursors() {
      const rows = await readAll<{ source_id: string; last_run_at: string | null }>((from, to) =>
        client.from("ingest_cursors").select("source_id,last_run_at").order("source_id").range(from, to),
      );
      return rows.map((r): CursorRow => ({ sourceId: r.source_id, lastRunAt: r.last_run_at }));
    },

    async listWatermarks(sourceId) {
      const rows = await readAll<{
        capability: string;
        ref: string;
        target_from: string;
        last_date: string | null;
        unavailable_before: string | null;
      }>((from, to) =>
        client
          .from("ingest_watermarks")
          .select("capability,ref,target_from,last_date,unavailable_before")
          .eq("source_id", sourceId)
          .order("capability")
          .order("ref")
          .range(from, to),
      );
      return rows.map((r): WatermarkRow => ({
        // `capability` is `text` with a CHECK constraint the generated type cannot carry.
        capability: r.capability as WatermarkRow["capability"],
        ref: r.ref,
        targetFrom: r.target_from,
        lastDate: r.last_date,
        unavailableBefore: r.unavailable_before,
      }));
    },

    async listAssets(scope: IngestScope, packIds: string[]) {
      if (packIds.length === 0) return [];
      // Enabling a pack backfills its SERIES; it does not price anybody's
      // holdings. Returning assets here would make a pack-enable run fetch
      // every quote in that market as a side effect of a settings change.
      if (scope.kind === "new_packs") return [];

      const rows = await readAll<{ id: string; pack_id: string; instrument_kind: string; identifier: string }>(
        (from, to) => {
          // Every filter must be applied BEFORE range(): range() paginates the
          // result of the filters that precede it, so narrowing afterwards
          // would page through the unfiltered set and drop matching rows.
          const filtered =
            scope.kind === "assets"
              ? client
                  .from("assets")
                  .select("id,pack_id,instrument_kind,identifier")
                  .in("pack_id", packIds)
                  .in("id", scope.assetIds)
              : client.from("assets").select("id,pack_id,instrument_kind,identifier").in("pack_id", packIds);
          // Ordered by key: an unordered offset page can overlap or skip between requests.
          return filtered.order("id").range(from, to);
        },
      );

      let selected = rows;
      if (scope.kind === "unpriced") {
        // The Refresh scope means "assets that have no price at all", so the
        // ones that already do must be subtracted. PostgREST cannot express
        // `not exists (...)`, so existence is resolved by reading the price
        // rows for these assets and diffing. The read is restricted to the
        // candidate ids and paginated; if price volume ever makes this
        // expensive it should become a database view or RPC rather than a
        // wider query here.
        const candidateIds = rows.map((r) => r.id);
        const pricedIds = new Set<string>();
        for (let i = 0; i < candidateIds.length; i += PAGE) {
          const chunk = candidateIds.slice(i, i + PAGE);
          const priced = await readAll<{ asset_id: string }>((from, to) =>
            client
              .from("prices")
              .select("asset_id")
              .in("asset_id", chunk)
              .order("asset_id")
              .order("date")
              .range(from, to),
          );
          for (const row of priced) pricedIds.add(row.asset_id);
        }
        selected = rows.filter((r) => !pricedIds.has(r.id));
      }

      return selected.map((r): AssetRow => ({
        assetId: r.id,
        packId: r.pack_id,
        instrumentKind: r.instrument_kind,
        identifier: r.identifier,
      }));
    },

    async earliestTradeDates(identifiers) {
      if (identifiers.length === 0) return {};
      // Join through assets so the answer is keyed by market ref, not asset id:
      // several users holding one ticker share a single fetch window.
      type Joined = { trade_date: string; assets: { identifier: string } | { identifier: string }[] | null };
      const rows = await readAll<Joined>((from, to) =>
        client
          .from("transactions")
          .select("trade_date,assets!inner(identifier)")
          .in("assets.identifier", identifiers)
          .order("trade_date", { ascending: true })
          .order("id")
          .range(from, to),
      );
      const out: Record<string, IsoDate> = {};
      for (const row of rows) {
        // PostgREST returns an embedded row as an object or a single-element
        // array depending on the relationship it infers; accept both.
        const joined = Array.isArray(row.assets) ? row.assets[0] : row.assets;
        const identifier = joined?.identifier;
        if (!identifier) continue;
        if (!out[identifier] || row.trade_date < out[identifier]) out[identifier] = row.trade_date;
      }
      return out;
    },

    async commitChunk(payload: CommitPayload) {
      const { data, error } = await client.rpc("commit_ingest_chunk", { payload: asJson(payload) });
      if (error) throw new Error(`store: commit failed (${error.code ?? "unknown"})`);
      // The RPC returns counts as jsonb; its shape is the function's contract.
      return data as unknown as CommitCounts;
    },
  };
}
