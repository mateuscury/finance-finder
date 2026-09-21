import { describe, expect, it } from "vitest";
import type { Db } from "@/lib/supabase/types";
import { createIngestStore } from "./store";

/**
 * A minimal fake of the PostgREST builder: `.select().in().order().range()`
 * chained, then awaited. It records every range() call so pagination can be
 * asserted, which is the behaviour that actually matters here.
 */
function fakeClient(tables: Record<string, unknown[]>) {
  const ranges: Record<string, Array<[number, number]>> = {};
  const client = {
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          rows = rows.filter((r) => (r as Record<string, unknown>)[col] === val);
          return builder;
        },
        in: (col: string, vals: unknown[]) => {
          // Supports PostgREST's embedded-path form, e.g. "assets.identifier".
          const read = (row: unknown): unknown =>
            col.split(".").reduce<unknown>((acc, part) => {
              const next = Array.isArray(acc) ? acc[0] : acc;
              return next && typeof next === "object" ? (next as Record<string, unknown>)[part] : undefined;
            }, row);
          rows = rows.filter((r) => vals.includes(read(r)));
          return builder;
        },
        order: () => builder,
        range: (from: number, to: number) => {
          (ranges[table] ??= []).push([from, to]);
          return {
            then: (resolve: (v: { data: unknown[]; error: null }) => unknown) =>
              resolve({ data: rows.slice(from, to + 1), error: null }),
          };
        },
      };
      return builder;
    },
    rpc: async () => ({ data: {}, error: null }),
  };
  return { client: client as unknown as Db, ranges };
}

const ASSETS = [
  { id: "a1", pack_id: "br", instrument_kind: "br.fii", identifier: "HGLG11" },
  { id: "a2", pack_id: "br", instrument_kind: "br.fii", identifier: "KNRI11" },
  { id: "a3", pack_id: "br", instrument_kind: "br.fii", identifier: "XPLG11" },
];

describe("createIngestStore — listAssets scopes", () => {
  it("all_enabled returns every asset in the activated packs", async () => {
    const { client } = fakeClient({ assets: ASSETS, prices: [] });
    const rows = await createIngestStore(client).listAssets({ kind: "all_enabled" }, ["br"]);
    expect(rows.map((r) => r.identifier)).toEqual(["HGLG11", "KNRI11", "XPLG11"]);
  });

  it("assets narrows to the ids requested", async () => {
    const { client } = fakeClient({ assets: ASSETS, prices: [] });
    const rows = await createIngestStore(client).listAssets({ kind: "assets", assetIds: ["a2"] }, ["br"]);
    expect(rows.map((r) => r.assetId)).toEqual(["a2"]);
  });

  it("unpriced returns ONLY assets that have no price row", async () => {
    // Previously this scope returned every asset, so a Refresh would re-fetch
    // the whole portfolio instead of just the gaps.
    const { client } = fakeClient({
      assets: ASSETS,
      prices: [{ asset_id: "a1" }, { asset_id: "a1" }, { asset_id: "a3" }],
    });
    const rows = await createIngestStore(client).listAssets({ kind: "unpriced" }, ["br"]);
    expect(rows.map((r) => r.assetId)).toEqual(["a2"]);
  });

  it("unpriced returns everything when nothing has been priced yet", async () => {
    const { client } = fakeClient({ assets: ASSETS, prices: [] });
    const rows = await createIngestStore(client).listAssets({ kind: "unpriced" }, ["br"]);
    expect(rows).toHaveLength(3);
  });

  it("new_packs prices no holdings at all — it exists to backfill series", async () => {
    const { client } = fakeClient({ assets: ASSETS, prices: [] });
    const rows = await createIngestStore(client).listAssets({ kind: "new_packs", packIds: ["br"] }, ["br"]);
    expect(rows).toEqual([]);
  });

  it("returns nothing when no pack is activated", async () => {
    const { client } = fakeClient({ assets: ASSETS, prices: [] });
    expect(await createIngestStore(client).listAssets({ kind: "all_enabled" }, [])).toEqual([]);
  });
});

describe("createIngestStore — pagination", () => {
  it("keeps requesting pages until one comes back short", async () => {
    const many = Array.from({ length: 1200 }, (_, i) => ({
      source_id: `br.s${i}`,
      last_run_at: null,
    }));
    const { client, ranges } = fakeClient({ ingest_cursors: many });
    const rows = await createIngestStore(client).listCursors();
    // The row cap must not be mistaken for a total: all 1200 are read.
    expect(rows).toHaveLength(1200);
    expect(ranges.ingest_cursors.length).toBeGreaterThan(1);
    expect(ranges.ingest_cursors[0]).toEqual([0, 499]);
  });

  it("paginates watermarks for one source", async () => {
    const many = Array.from({ length: 700 }, (_, i) => ({
      source_id: "br.brapi",
      capability: "historical",
      ref: `T${i}`,
      target_from: "2026-01-01",
      last_date: null,
      unavailable_before: null,
    }));
    const { client } = fakeClient({ ingest_watermarks: many });
    expect(await createIngestStore(client).listWatermarks("br.brapi")).toHaveLength(700);
  });
});

describe("createIngestStore — earliestTradeDates", () => {
  it("keys the earliest trade by market ref, so co-holders share one window", async () => {
    const { client } = fakeClient({
      transactions: [
        { trade_date: "2026-05-01", assets: { identifier: "HGLG11" } },
        { trade_date: "2025-02-03", assets: { identifier: "HGLG11" } },
        { trade_date: "2026-01-01", assets: [{ identifier: "KNRI11" }] },
      ],
    });
    const out = await createIngestStore(client).earliestTradeDates(["HGLG11", "KNRI11"]);
    expect(out).toEqual({ HGLG11: "2025-02-03", KNRI11: "2026-01-01" });
  });

  it("returns nothing for an empty identifier list without querying", async () => {
    const { client, ranges } = fakeClient({ transactions: [] });
    expect(await createIngestStore(client).earliestTradeDates([])).toEqual({});
    expect(ranges.transactions).toBeUndefined();
  });
});
