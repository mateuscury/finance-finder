/**
 * Real-database tests for `commit_ingest_chunk` — the two integration tests
 * docs/milestone-1-plan.md §3.3 demanded, backfilled under MILESTONES.md §2
 * decision 8. The unit suite proves the scheduler; only Postgres can prove
 * that the RPC's conflict clause and its single transaction behave as the
 * migration claims.
 *
 * Runs under `pnpm test:db` only. Reads every price back as TEXT so no value
 * passes through a float on its way to an assertion.
 */
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { setupThrowawayUser } from "@/lib/testing/db";
import type { TableName } from "@/lib/supabase/types";
import type { CommitPayload } from "./ingest";
import { createIngestStore } from "./store";

// Distinct ids per concern so a cursor written by one test cannot satisfy or
// spoil an assertion in another. `zz.` matches the source-id check constraint
// and can never collide with a registered pack.
const PROTECT_SOURCE = "zz.dbtest_protect";
const ROLLBACK_SOURCE = "zz.dbtest_rollback";
const ROLLBACK_SERIES = "zz.dbtest_rollback_series";

const owner = setupThrowawayUser();
const store = createIngestStore(owner.client);

// The global tables do not cascade from the auth user (no user_id by design).
afterAll(async () => {
  const client = owner.client;
  await client.from("ingest_watermarks").delete().in("source_id", [PROTECT_SOURCE, ROLLBACK_SOURCE]);
  await client.from("ingest_cursors").delete().in("source_id", [PROTECT_SOURCE, ROLLBACK_SOURCE]);
  await client.from("series_points").delete().eq("series_id", ROLLBACK_SERIES);
});

async function createAsset(identifier: string): Promise<string> {
  const { data, error } = await owner.client
    .from("assets")
    .insert({
      user_id: owner.userId,
      pack_id: "br",
      instrument_kind: "br.fii",
      identifier,
      name: identifier,
      native_currency: "BRL",
      metadata: {},
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(`dbtest: could not create asset (${error?.message ?? "no row"})`);
  return data.id as string;
}

async function priceRow(assetId: string, date: string): Promise<{ price: string; source_id: string } | null> {
  const { data, error } = await owner.client
    .from("prices")
    .select("price::text,source_id")
    .eq("asset_id", assetId)
    .eq("date", date)
    .maybeSingle();
  if (error) throw new Error(`dbtest: could not read price (${error.message})`);
  return data ? { price: String(data.price), source_id: String(data.source_id) } : null;
}

async function countRows(table: TableName, column: string, value: string): Promise<number> {
  const { count, error } = await owner.client
    .from(table)
    .select("*", { head: true, count: "exact" })
    .eq(column as never, value);
  if (error) throw new Error(`dbtest: could not count ${table} (${error.message})`);
  return count ?? 0;
}

function chunk(overrides: Partial<CommitPayload> & Pick<CommitPayload, "source_id">): CommitPayload {
  return {
    prices: [],
    series_points: [],
    watermarks: [],
    cursor: { last_date: null, last_error: null },
    ...overrides,
  };
}

describe("commit_ingest_chunk: a manual price always wins", () => {
  it("refuses to overwrite a manual row, writes the rest, and reports the row it protected", async () => {
    const assetId = await createAsset(`DBTEST-${randomUUID().slice(0, 8)}`);
    const { error } = await owner.client
      .from("prices")
      .insert({ asset_id: assetId, date: "2026-03-02", price: "100.5", currency: "BRL", source_id: "manual" });
    if (error) throw new Error(`dbtest: could not seed manual price (${error.message})`);

    const counts = await store.commitChunk(
      chunk({
        source_id: PROTECT_SOURCE,
        prices: [
          // Collides with the user's manual row: must be left untouched.
          { asset_id: assetId, date: "2026-03-02", price: "999.25", currency: "BRL" },
          // No row yet: must be written with the source's provenance.
          { asset_id: assetId, date: "2026-03-03", price: "101.75", currency: "BRL" },
        ],
        cursor: { last_date: "2026-03-03", last_error: null },
      }),
    );

    expect(counts).toEqual({ prices_written: 1, manual_protected: 1, series_written: 0, watermarks_advanced: 0 });
    // numeric(24,10)::text carries the full stored scale.
    expect(await priceRow(assetId, "2026-03-02")).toEqual({ price: "100.5000000000", source_id: "manual" });
    expect(await priceRow(assetId, "2026-03-03")).toEqual({ price: "101.7500000000", source_id: PROTECT_SOURCE });
  });

  it("still lets a source correct its own earlier price", async () => {
    const assetId = await createAsset(`DBTEST-${randomUUID().slice(0, 8)}`);
    const first = chunk({
      source_id: PROTECT_SOURCE,
      prices: [{ asset_id: assetId, date: "2026-03-04", price: "10", currency: "BRL" }],
    });
    await store.commitChunk(first);

    const counts = await store.commitChunk(
      chunk({
        source_id: PROTECT_SOURCE,
        prices: [{ asset_id: assetId, date: "2026-03-04", price: "10.5", currency: "BRL" }],
      }),
    );

    expect(counts.prices_written).toBe(1);
    expect(counts.manual_protected).toBe(0);
    expect(await priceRow(assetId, "2026-03-04")).toEqual({ price: "10.5000000000", source_id: PROTECT_SOURCE });
  });
});

describe("commit_ingest_chunk: one transaction", () => {
  it("rolls back prices, series points and the cursor together when a later write fails", async () => {
    const assetId = await createAsset(`DBTEST-${randomUUID().slice(0, 8)}`);
    const ref = `rollback-${randomUUID()}`;

    const payload = chunk({
      source_id: ROLLBACK_SOURCE,
      prices: [{ asset_id: assetId, date: "2026-03-02", price: "50", currency: "BRL" }],
      series_points: [{ series_id: ROLLBACK_SERIES, date: "2026-03-02", value: "0.0004", tenor_days: 0 }],
      watermarks: [
        // Violates ingest_watermarks_last_date_check (last_date < target_from).
        // The RPC writes prices (step 1) and series points (step 2) BEFORE it
        // reaches this insert (step 3), so the absence assertions below are
        // exactly the atomicity claim in the migration header.
        { capability: "spot", ref, target_from: "2026-03-02", last_date: "2026-01-01", unavailable_before: null },
      ],
      cursor: { last_date: "2026-03-02", last_error: null },
    });

    // 23514 = check_violation: proves the failure was the constraint, not transport.
    await expect(store.commitChunk(payload)).rejects.toThrow("store: commit failed (23514)");

    expect(await priceRow(assetId, "2026-03-02")).toBeNull();
    expect(await countRows("series_points", "series_id", ROLLBACK_SERIES)).toBe(0);
    expect(await countRows("ingest_watermarks", "source_id", ROLLBACK_SOURCE)).toBe(0);
    expect(await countRows("ingest_cursors", "source_id", ROLLBACK_SOURCE)).toBe(0);
  });
});
