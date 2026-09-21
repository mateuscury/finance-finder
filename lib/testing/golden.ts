/**
 * The BR golden portfolio as one user's database rows — the seed every
 * real-database test builds on (backup round trip, the RLS read path, the
 * snapshot job). Ids are preserved through a golden-id → uuid map so a test
 * can compare kernel output with `expected.json`.
 *
 * Series are global (no user) and are upserted, so a previous run's rows
 * never collide; a test that seeds them cleans them up in its `afterAll`.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GoldenFixtureSchema, type GoldenFixture } from "@/lib/calc/golden";

const ROOT = path.resolve(__dirname, "../..");

export function loadGoldenFixture(packId = "br"): { fixture: GoldenFixture; expected: Record<string, unknown> } {
  const read = (file: string) =>
    JSON.parse(fs.readFileSync(path.join(ROOT, "packs", packId, "fixtures", file), "utf8")) as unknown;
  return {
    fixture: GoldenFixtureSchema.parse(read("portfolio.json")),
    expected: read("expected.json") as Record<string, unknown>,
  };
}

async function mustInsert(admin: SupabaseClient, table: string, rows: Record<string, unknown>[]): Promise<void> {
  const { error } = await admin.from(table).insert(rows);
  if (error) throw new Error(`dbtest: seeding ${table} failed (${error.message})`);
}

export interface SeededGolden {
  /** Golden asset id → the uuid it was stored under. */
  uuidOf: Map<string, string>;
  /** The inverse, for re-keying kernel output. */
  goldenIdOf: Map<string, string>;
}

/** Seeds settings, assets, transactions, cash flows, prices and (when asked) the global series. */
export async function seedGoldenPortfolio(
  admin: SupabaseClient,
  userId: string,
  fixture: GoldenFixture,
  options: { series?: boolean; enabledPacks?: string[] } = {},
): Promise<SeededGolden> {
  const uuidOf = new Map(fixture.assets.map((a) => [a.id, randomUUID()] as const));
  const settings = await admin.from("user_settings").upsert({
    user_id: userId,
    base_currency: fixture.baseCurrency,
    enabled_packs: options.enabledPacks ?? ["br"],
    locale: "pt-BR",
    theme: "system",
  });
  if (settings.error) throw new Error(`dbtest: seeding user_settings failed (${settings.error.message})`);
  await mustInsert(
    admin,
    "assets",
    fixture.assets.map((a) => ({
      id: uuidOf.get(a.id),
      user_id: userId,
      pack_id: a.instrumentKind.slice(0, a.instrumentKind.indexOf(".")),
      instrument_kind: a.instrumentKind,
      identifier: a.identifier,
      name: a.identifier,
      native_currency: a.nativeCurrency,
      metadata: a.metadata,
    })),
  );
  await mustInsert(
    admin,
    "transactions",
    fixture.transactions.map((t) => ({
      id: randomUUID(),
      user_id: userId,
      asset_id: uuidOf.get(t.assetId),
      trade_date: t.tradeDate,
      type: t.type,
      quantity: t.quantity,
      unit_price: t.unitPrice,
      currency: t.currency,
      fees: t.fees,
      fx_rate: t.fxRate,
      note: null,
    })),
  );
  await mustInsert(
    admin,
    "cash_flows",
    fixture.cashFlows.map((f) => ({
      id: randomUUID(),
      user_id: userId,
      date: f.date,
      amount: f.amount,
      currency: f.currency,
      note: null,
    })),
  );
  const byIdentifier = new Map(fixture.assets.map((a) => [a.identifier, uuidOf.get(a.id)!] as const));
  await mustInsert(
    admin,
    "prices",
    Object.entries(fixture.prices).flatMap(([identifier, rows]) =>
      rows.map((r) => ({
        asset_id: byIdentifier.get(identifier),
        date: r.date,
        price: r.price,
        currency: r.currency,
        source_id: r.sourceId,
      })),
    ),
  );
  if (options.series) {
    const rows = Object.entries(fixture.series).flatMap(([seriesId, points]) =>
      points.map((p) => ({ series_id: seriesId, date: p.date, value: p.value, tenor_days: p.tenorDays })),
    );
    const upsert = await admin.from("series_points").upsert(rows, { onConflict: "series_id,date,tenor_days" });
    if (upsert.error) throw new Error(`dbtest: seeding series_points failed (${upsert.error.message})`);
  }
  return { uuidOf, goldenIdOf: new Map([...uuidOf].map(([g, u]) => [u, g] as const)) };
}

/** Removes the fixture's global series rows (they have no user to cascade from). */
export async function removeGoldenSeries(admin: SupabaseClient, fixture: GoldenFixture): Promise<void> {
  for (const [seriesId, points] of Object.entries(fixture.series)) {
    const dates = points.map((p) => p.date);
    const { error } = await admin.from("series_points").delete().eq("series_id", seriesId).in("date", dates);
    if (error) throw new Error(`dbtest: cleaning series_points failed (${error.message})`);
  }
}
