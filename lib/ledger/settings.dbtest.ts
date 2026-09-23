/**
 * Settings and "your data" against the real database (specs/SPEC.md US-008
 * AC-008.1, AC-008.3, AC-008.4, AC-008.5). Runs under `pnpm test:db` only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { parseBackup, serializeBackup } from "@/lib/backup";
import { writeCsv } from "@/lib/csv/write";
import { parseCsv } from "@/lib/csv/parse";
import { CANONICAL_COLUMNS, dryRun, type KnownAsset, type KnownTransaction } from "@/lib/import";
import { deleteUserJob } from "@/lib/jobs";
import {
  assertStackReachable,
  createDbTestClient,
  createThrowawayUser,
  type ThrowawayUserHandle,
} from "@/lib/testing/db";
import type { UserTable } from "@/lib/supabase/types";
import { loadGoldenFixture, seedGoldenPortfolio } from "@/lib/testing/golden";
import { readAll } from "@/lib/supabase/paginate";
import { readSettings } from "./rows";
import { setEnabledPacks, stampExport, updatePreferences } from "./settings";

const admin = createDbTestClient();
const users: ThrowawayUserHandle[] = [];
async function newUser(): Promise<ThrowawayUserHandle> {
  const u = await createThrowawayUser(admin);
  users.push(u);
  return u;
}
const { fixture } = loadGoldenFixture();
const T = fixture.transactions.length;
beforeAll(async () => {
  await assertStackReachable(admin);
});
afterAll(async () => {
  for (const u of users) await u.remove();
});

describe("settings", () => {
  it("packs, preferences and the export stamp persist through RLS", async () => {
    const a = await newUser();
    await seedGoldenPortfolio(admin, a.userId, fixture);
    const client = await a.signIn();
    expect(await setEnabledPacks(client, a.userId, PACKS, ["br", "global"])).toEqual({
      ok: true,
      value: { newlyEnabled: ["global"] },
    });
    expect(await updatePreferences(client, a.userId, { theme: "dark", locale: "en" })).toEqual({
      ok: true,
      value: undefined,
    });
    expect(await stampExport(client, a.userId, new Date("2026-09-20T12:00:00Z"))).toEqual({
      ok: true,
      value: undefined,
    });
    const s = await readSettings(client);
    expect(s).toMatchObject({ enabled_packs: ["br", "global"], theme: "dark", locale: "en" });
    expect(s.last_export_at).toMatch(/^2026-09-20T12:00:00/);
  });

  it("refuses to disable a pack whose assets are still held (decision 61)", async () => {
    const u = await newUser();
    const client = await u.signIn();
    await seedGoldenPortfolio(admin, u.userId, fixture, { series: false });
    // The golden's assets are all `br`.
    expect(await setEnabledPacks(client, u.userId, PACKS, ["global"])).toEqual({
      ok: false,
      reason: "pack_in_use",
      fields: ["enabled_packs"],
    });
    const after = await client.from("user_settings").select("enabled_packs").eq("user_id", u.userId).single();
    expect((after.data as { enabled_packs: string[] }).enabled_packs).toContain("br");
  });

  it("the export's companion CSV, written by lib/csv from export_backup, re-imports as all duplicates", async () => {
    const a = await newUser();
    await seedGoldenPortfolio(admin, a.userId, fixture);
    const client = await a.signIn();
    const { data, error } = await client.rpc("export_backup");
    expect(error).toBeNull();
    const parsed = parseBackup(data);
    if (!parsed.ok) throw new Error(parsed.issues.join("; "));
    // serialize is deterministic and re-parses.
    expect(parseBackup(JSON.parse(serializeBackup(parsed.backup))).ok).toBe(true);
    const assets = new Map(parsed.backup.assets.map((x) => [x.id, x] as const));
    const rows = parsed.backup.transactions.map((t) => {
      const x = assets.get(t.asset_id)!;
      return [
        t.trade_date,
        t.type,
        x.pack_id,
        x.instrument_kind,
        x.identifier,
        t.quantity,
        t.unit_price,
        t.currency,
        t.fees,
        t.note ?? "",
      ];
    });
    const csv = parseCsv(writeCsv([...CANONICAL_COLUMNS], rows));
    if (!csv.ok) throw new Error(csv.reason);
    const known = await readAll<KnownAsset>((from, to) =>
      client.from("assets").select("id,pack_id,instrument_kind,identifier,native_currency").order("id").range(from, to),
    );
    const existing = await readAll<KnownTransaction>((from, to) =>
      client
        .from("transactions")
        .select("asset_id,trade_date,type,quantity::text,unit_price::text")
        .order("id")
        .range(from, to),
    );
    const run = dryRun(csv.header, csv.rows, {}, known, existing, PACKS);
    expect(run.ok && run.counts).toMatchObject({ total: T, valid: T, errors: 0, unresolved: 0, duplicates: T });
  });

  it("delete everything cascades from auth.users and leaves market data alone", async () => {
    const a = await newUser();
    await seedGoldenPortfolio(admin, a.userId, fixture, { series: true });
    const before = await admin
      .from("series_points")
      .select("*", { count: "exact", head: true })
      .eq("series_id", "br.cdi");
    expect(await deleteUserJob(a.userId)).toEqual({ ok: true });
    for (const table of [
      "user_settings",
      "assets",
      "transactions",
      "cash_flows",
      "portfolio_snapshots",
      "csv_imports",
    ]) {
      const { count } = await admin
        .from(table as UserTable)
        .select("*", { count: "exact", head: true })
        .eq("user_id", a.userId);
      expect(count, table).toBe(0);
    }
    const after = await admin
      .from("series_points")
      .select("*", { count: "exact", head: true })
      .eq("series_id", "br.cdi");
    expect(after.count).toBe(before.count);
    const gone = await admin.auth.admin.getUserById(a.userId);
    expect(gone.data.user).toBeNull();
  });
});
