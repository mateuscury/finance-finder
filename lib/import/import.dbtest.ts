/**
 * CSV import against the real database (specs/SPEC.md US-007 AC-007.5,
 * AC-007.6, AC-007.7): the stored upload → dry run under RLS → one-statement
 * commit; re-importing the ledger's own export is a no-op; a batch with one
 * bad row writes nothing.
 *
 * Runs under `pnpm test:db` only.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { writeCsv } from "@/lib/csv/write";
import { parseCsv } from "@/lib/csv/parse";
import {
  assertStackReachable,
  createDbTestClient,
  createThrowawayUser,
  type ThrowawayUserHandle,
} from "@/lib/testing/db";
import { loadGoldenFixture, seedGoldenPortfolio } from "@/lib/testing/golden";
import { loadDryRun } from "@/app/(app)/transactions/import/load";
import { CANONICAL_COLUMNS } from "./mapping";
import { dryRun, type KnownAsset, type KnownTransaction } from "./dryRun";
import { planCommit } from "./commit";

const admin = createDbTestClient();
const users: ThrowawayUserHandle[] = [];
async function newUser(): Promise<ThrowawayUserHandle> {
  const u = await createThrowawayUser(admin);
  users.push(u);
  return u;
}
const { fixture } = loadGoldenFixture();
/** The golden's transaction count: the CSV under test is the golden ledger itself. */
const T = fixture.transactions.length;
beforeAll(async () => {
  await assertStackReachable(admin);
});
afterAll(async () => {
  for (const u of users) await u.remove();
});

/** The golden ledger as the app's export writes it (identifier-keyed, canonical columns). */
function goldenCsv(extra: string[][] = []): string {
  const identifierOf = new Map(
    fixture.assets.map((a) => [a.id, { identifier: a.identifier, kind: a.instrumentKind }] as const),
  );
  const rows = fixture.transactions.map((t) => {
    const a = identifierOf.get(t.assetId)!;
    return [
      t.tradeDate,
      t.type,
      a.kind.slice(0, a.kind.indexOf(".")),
      a.kind,
      a.identifier,
      t.quantity,
      t.unitPrice,
      t.currency,
      t.fees,
      "",
    ];
  });
  return writeCsv([...CANONICAL_COLUMNS], [...rows, ...extra]);
}

async function transactionCount(userId: string): Promise<number> {
  const { count } = await admin.from("transactions").select("*", { count: "exact", head: true }).eq("user_id", userId);
  return count ?? -1;
}

describe("CSV import on the live path", () => {
  it("re-importing the ledger's own export is all duplicates and plans nothing; new rows commit in one statement", async () => {
    const owner = await newUser();
    await seedGoldenPortfolio(admin, owner.userId, fixture);
    const client = await owner.signIn();

    // Upload the export of what is already there.
    expect(
      (
        await client
          .from("csv_imports")
          .upsert({ user_id: owner.userId, filename: "export.csv", content: goldenCsv() }, { onConflict: "user_id" })
      ).error,
    ).toBeNull();
    const same = await loadDryRun(client, PACKS);
    expect(same.kind).toBe("preview");
    if (same.kind !== "preview" || !same.run.ok) throw new Error("no preview");
    expect(same.run.counts).toMatchObject({ total: T, valid: T, errors: 0, unresolved: 0, duplicates: T });
    expect(planCommit(same.run, same.run.previewHash, new Set())).toEqual({ ok: false, reason: "nothing_to_import" });

    // Two new rows and one repeat: the plan holds exactly two, the insert is one statement.
    const content = goldenCsv([
      ["2026-03-02", "buy", "br", "br.fii", "HGLG11", "5", "157.10", "BRL", "0.50", "March"],
      ["2026-03-03", "interest", "br", "br.cdb", "cdb-banco-x-2028", "0", "12.34", "BRL", "0", ""],
    ]);
    expect(
      (
        await client
          .from("csv_imports")
          .upsert({ user_id: owner.userId, filename: "march.csv", content }, { onConflict: "user_id" })
      ).error,
    ).toBeNull();
    const loaded = await loadDryRun(client, PACKS);
    if (loaded.kind !== "preview" || !loaded.run.ok) throw new Error("no preview");
    expect(loaded.run.counts).toMatchObject({ total: T + 2, duplicates: T, unresolved: 0, errors: 0 });
    const plan = planCommit(loaded.run, loaded.run.previewHash, new Set());
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.rows).toHaveLength(2);
    expect(plan.skippedDuplicates).toBe(fixture.transactions.length);
    const before = await transactionCount(owner.userId);
    const insert = await client.from("transactions").insert(plan.rows.map((r) => ({ user_id: owner.userId, ...r })));
    expect(insert.error).toBeNull();
    expect(await transactionCount(owner.userId)).toBe(before + 2);
    // Committed rows are text-exact, and the note survived.
    const { data } = await admin
      .from("transactions")
      .select("quantity::text,unit_price::text,note")
      .eq("user_id", owner.userId)
      .eq("trade_date", "2026-03-02")
      .single();
    expect(data).toEqual({ quantity: "5.0000000000", unit_price: "157.1000000000", note: "March" });

    // Importing the same file again is now entirely duplicates.
    const again = await loadDryRun(client, PACKS);
    if (again.kind !== "preview" || !again.run.ok) throw new Error("no preview");
    expect(again.run.counts.duplicates).toBe(T + 2);
  });

  it("a batch with one row the database refuses writes nothing", async () => {
    const owner = await newUser();
    const seed = await seedGoldenPortfolio(admin, owner.userId, fixture);
    const stranger = await newUser();
    const theirs = await seedGoldenPortfolio(admin, stranger.userId, fixture);
    const client = await owner.signIn();
    const before = await transactionCount(owner.userId);
    const good = {
      asset_id: seed.uuidOf.get("fii")!,
      trade_date: "2026-04-01",
      type: "buy" as const,
      quantity: "1",
      unit_price: "1",
      currency: "BRL",
      fees: "0",
      note: null,
    };
    const bad = { ...good, asset_id: theirs.uuidOf.get("fii")! }; // another user's asset: the composite FK refuses
    const insert = await client.from("transactions").insert([good, bad].map((r) => ({ user_id: owner.userId, ...r })));
    expect(insert.error).not.toBeNull();
    expect(await transactionCount(owner.userId)).toBe(before);
  });

  it("an unresolved identifier blocks the commit until the asset exists, then resolves through the same dry run", async () => {
    const owner = await newUser();
    await seedGoldenPortfolio(admin, owner.userId, fixture);
    const client = await owner.signIn();
    const content = goldenCsv([["2026-03-02", "buy", "br", "br.fii", "XPLG11", "5", "100", "BRL", "0", ""]]);
    expect(
      (
        await client
          .from("csv_imports")
          .upsert({ user_id: owner.userId, filename: "new.csv", content }, { onConflict: "user_id" })
      ).error,
    ).toBeNull();
    const first = await loadDryRun(client, PACKS);
    if (first.kind !== "preview" || !first.run.ok) throw new Error("no preview");
    expect(first.run.unresolved).toEqual([
      {
        pack_id: "br",
        instrument_kind: "br.fii",
        identifier: "XPLG11",
        rows: [fixture.transactions.length],
        registered: true,
      },
    ]);
    expect(planCommit(first.run, first.run.previewHash, new Set())).toEqual({
      ok: false,
      reason: "unresolved_identifiers",
    });
    expect(
      (
        await client.from("assets").insert({
          user_id: owner.userId,
          pack_id: "br",
          instrument_kind: "br.fii",
          identifier: "XPLG11",
          name: "XP Log",
          native_currency: "BRL",
          metadata: { fundName: "XP Log" },
        })
      ).error,
    ).toBeNull();
    const second = await loadDryRun(client, PACKS);
    if (second.kind !== "preview" || !second.run.ok) throw new Error("no preview");
    expect(second.run.counts.unresolved).toBe(0);
    // The preview hash is over the parsed values, so creating the asset did not invalidate the commit.
    expect(second.run.previewHash).toBe(first.run.previewHash);
    const plan = planCommit(second.run, first.run.previewHash, new Set());
    expect(plan.ok && plan.rows.length).toBe(1);
  });

  it("the pure dry run agrees with the live one on the same rows", () => {
    const parsed = parseCsv(goldenCsv());
    if (!parsed.ok) throw new Error(parsed.reason);
    const assets: KnownAsset[] = fixture.assets.map((a, i) => ({
      id: `00000000-0000-4000-8000-00000000000${i}`,
      pack_id: "br",
      instrument_kind: a.instrumentKind,
      identifier: a.identifier,
      native_currency: "BRL",
    }));
    const existing: KnownTransaction[] = [];
    const run = dryRun(parsed.header, parsed.rows, {}, assets, existing, PACKS);
    expect(run.ok && run.counts).toMatchObject({ total: T, valid: T, duplicates: 0 });
  });
});
