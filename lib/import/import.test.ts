import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { planCommit } from "./commit";
import { dryRun, type KnownAsset, type KnownTransaction } from "./dryRun";
import { normalizeColumnMap, resolveColumns } from "./mapping";

const HEADER = [
  "date",
  "type",
  "pack",
  "instrument_kind",
  "identifier",
  "quantity",
  "unit_price",
  "currency",
  "fees",
  "note",
];
const FII: KnownAsset = {
  id: "11111111-1111-4111-8111-111111111111",
  pack_id: "br",
  instrument_kind: "br.fii",
  identifier: "HGLG11",
  native_currency: "BRL",
};
const row = (over: Partial<Record<(typeof HEADER)[number], string>> = {}): string[] => {
  const base: Record<string, string> = {
    date: "2024-03-14",
    type: "buy",
    pack: "br",
    instrument_kind: "br.fii",
    identifier: "HGLG11",
    quantity: "100",
    unit_price: "162.40",
    currency: "BRL",
    fees: "2.50",
    note: "",
  };
  return HEADER.map((h) => over[h] ?? base[h]);
};

describe("resolveColumns", () => {
  it("maps canonical headers by name, case-insensitively, ignoring unknown columns", () => {
    const r = resolveColumns([
      "Note",
      "extra",
      "DATE",
      "type",
      "pack",
      "instrument_kind",
      "identifier",
      "quantity",
      "unit_price",
      "currency",
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.indexOf).toMatchObject({ date: 2, note: 0, fees: null, currency: 9 });
  });

  it("applies a user's map and reports missing required columns", () => {
    const r = resolveColumns(["Data", "Tipo", "pack", "instrument_kind", "Código", "Qtd", "Preço", "currency"], {
      date: "Data",
      type: "Tipo",
      identifier: "Código",
      quantity: "Qtd",
      unit_price: "Preço",
    });
    expect(r.ok).toBe(true);
    const missing = resolveColumns(["date", "type", "pack"]);
    expect(missing).toEqual({
      ok: false,
      missing: ["instrument_kind", "identifier", "quantity", "unit_price", "currency"],
    });
  });

  it("normalizeColumnMap keeps only real overrides", () => {
    expect(normalizeColumnMap({ date: "Data", type: " type ", quantity: "", bogus: "x", fees: 3 })).toEqual({
      date: "Data",
    });
    expect(normalizeColumnMap(null)).toEqual({});
  });
});

describe("dryRun", () => {
  it("validates per row with canonical field names, resolves assets by identity, and flags duplicates against the ledger and within the file", () => {
    const existing: KnownTransaction[] = [
      {
        asset_id: FII.id,
        trade_date: "2024-03-14",
        type: "buy",
        quantity: "100.0000000000",
        unit_price: "162.4000000000",
      },
    ];
    const rows = [
      row(),
      row({ date: "2024-06-28", type: "dividend", quantity: "0", unit_price: "132.00", fees: "0", note: "June" }),
      row({ quantity: "abc" }),
      row({ identifier: "xplg11" }),
      row({ date: "2024-06-28", type: "dividend", quantity: "0", unit_price: "132.00", fees: "0" }),
    ];
    const run = dryRun(HEADER, rows, {}, [FII], existing, PACKS);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.rows.map((r) => [r.index, r.errors, r.assetId !== null, r.duplicate])).toEqual([
      [0, [], true, true], // in the ledger already, despite the scale difference
      [1, [], true, false],
      [2, ["quantity"], true, false],
      [3, [], false, false], // unresolved
      [4, [], true, true], // repeats row 1 inside the file
    ]);
    expect(run.unresolved).toEqual([
      { pack_id: "br", instrument_kind: "br.fii", identifier: "XPLG11", rows: [3], registered: true },
    ]);
    expect(run.counts).toEqual({ total: 5, valid: 3, errors: 1, unresolved: 1, duplicates: 2 });
    expect(run.rows[1].parsed).toMatchObject({ asset_id: FII.id, note: "June", fees: "0" });
  });

  it("reports missing required columns as a file-level error and an unregistered kind as unresolved-but-not-creatable", () => {
    expect(dryRun(["date", "type"], [], {}, [FII], [], PACKS)).toMatchObject({ ok: false, reason: "missing_columns" });
    const run = dryRun(HEADER, [row({ instrument_kind: "br.nope" })], {}, [FII], [], PACKS);
    expect(run.ok && run.unresolved[0]).toMatchObject({ instrument_kind: "br.nope", registered: false });
  });

  it("the preview hash changes when a value changes and not when nothing does", () => {
    const a = dryRun(HEADER, [row()], {}, [FII], [], PACKS);
    const b = dryRun(HEADER, [row()], {}, [FII], [], PACKS);
    const c = dryRun(HEADER, [row({ quantity: "101" })], {}, [FII], [], PACKS);
    expect(a.ok && b.ok && a.previewHash).toBe(b.ok && b.previewHash);
    expect(a.ok && c.ok && a.previewHash === c.previewHash).toBe(false);
  });
});

describe("dryRun oversell (SPEC §9.1, §6; decision 58)", () => {
  const sell = (over: Record<string, string> = {}) => row({ type: "sell", quantity: "-100", ...over });

  it("marks a sell the ledger cannot cover, and blocks the commit like any other row error", () => {
    const run = dryRun(HEADER, [sell({ date: "2024-04-01" })], {}, [FII], [], PACKS);
    if (!run.ok) throw new Error("run failed");
    expect(run.rows[0].oversell).toBe(true);
    expect(run.rows[0].errors).toContain("quantity");
    expect(run.counts.errors).toBe(1);
    expect(planCommit(run, run.previewHash, new Set())).toMatchObject({ ok: false, reason: "rows_have_errors" });
  });

  it("does NOT mark a sell a buy further down the file covers, when the buy is the earlier trade", () => {
    // The sell is row 0 and dated AFTER the buy on row 1: FIFO orders by trade
    // date, not by file order, so the file covers itself.
    const run = dryRun(
      HEADER,
      [sell({ date: "2024-04-01", quantity: "-100" }), row({ date: "2024-03-14", quantity: "100" })],
      {},
      [FII],
      [],
      PACKS,
    );
    if (!run.ok) throw new Error("run failed");
    expect(run.rows.map((r) => r.oversell)).toEqual([false, false]);
    expect(run.counts.errors).toBe(0);
  });

  it("counts the existing ledger, so a sell covered by rows already in the database is fine", () => {
    const existing = [{ asset_id: FII.id, trade_date: "2024-01-02", type: "buy", quantity: "100", unit_price: "150" }];
    const run = dryRun(HEADER, [sell({ date: "2024-04-01" })], {}, [FII], existing, PACKS);
    if (!run.ok) throw new Error("run failed");
    expect(run.rows[0].oversell).toBe(false);
    expect(run.counts.errors).toBe(0);
  });

  it("names every offending row, not just the first", () => {
    const run = dryRun(
      HEADER,
      [sell({ date: "2024-04-01", quantity: "-5" }), sell({ date: "2024-04-02", quantity: "-7" })],
      {},
      [FII],
      [],
      PACKS,
    );
    if (!run.ok) throw new Error("run failed");
    expect(run.rows.map((r) => r.oversell)).toEqual([true, true]);
  });
});

describe("planCommit", () => {
  const fresh = () => dryRun(HEADER, [row(), row({ date: "2024-03-15" })], {}, [FII], [], PACKS);

  it("refuses a changed preview, errors, unresolved identifiers and an empty result", () => {
    const run = fresh();
    if (!run.ok) throw new Error("dry run failed");
    expect(planCommit(run, "stale", new Set())).toEqual({ ok: false, reason: "preview_changed" });
    const withError = dryRun(HEADER, [row({ quantity: "x" })], {}, [FII], [], PACKS);
    expect(withError.ok && planCommit(withError, withError.previewHash, new Set())).toEqual({
      ok: false,
      reason: "rows_have_errors",
    });
    const unresolved = dryRun(HEADER, [row({ identifier: "OTHER" })], {}, [FII], [], PACKS);
    expect(unresolved.ok && planCommit(unresolved, unresolved.previewHash, new Set())).toEqual({
      ok: false,
      reason: "unresolved_identifiers",
    });
    const allDup = dryRun(
      HEADER,
      [row()],
      {},
      [FII],
      [{ asset_id: FII.id, trade_date: "2024-03-14", type: "buy", quantity: "100", unit_price: "162.4" }],
      PACKS,
    );
    expect(allDup.ok && planCommit(allDup, allDup.previewHash, new Set())).toEqual({
      ok: false,
      reason: "nothing_to_import",
    });
  });

  it("skips duplicates unless force-included", () => {
    const existing = [
      { asset_id: FII.id, trade_date: "2024-03-14", type: "buy", quantity: "100", unit_price: "162.4" },
    ];
    const run = dryRun(HEADER, [row(), row({ date: "2024-03-15" })], {}, [FII], existing, PACKS);
    if (!run.ok) throw new Error("dry run failed");
    const skip = planCommit(run, run.previewHash, new Set());
    expect(skip.ok && [skip.rows.length, skip.skippedDuplicates, skip.forced]).toEqual([1, 1, 0]);
    const force = planCommit(run, run.previewHash, new Set([0]));
    expect(force.ok && [force.rows.length, force.skippedDuplicates, force.forced]).toEqual([2, 0, 1]);
  });

  const qty = fc.integer({ min: 1, max: 100000 }).map((n) => `${n}`);
  const price = fc
    .integer({ min: 1, max: 100000 })
    .map((n) => `${Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`);
  const day = fc.integer({ min: 1, max: 28 }).map((d) => `2024-03-${String(d).padStart(2, "0")}`);
  const ledgerRow = fc.record({ date: day, quantity: qty, unit_price: price });

  it("property: re-importing a file already in the ledger plans zero rows", () => {
    fc.assert(
      fc.property(fc.array(ledgerRow, { minLength: 1, maxLength: 12 }), (rows) => {
        const csv = rows.map((r) => row({ date: r.date, quantity: r.quantity, unit_price: r.unit_price }));
        // First import: everything not repeated within the file is planned.
        const first = dryRun(HEADER, csv, {}, [FII], [], PACKS);
        if (!first.ok) throw new Error("dry run failed");
        const plan = planCommit(first, first.previewHash, new Set());
        const inserted = plan.ok ? plan.rows : [];
        // The ledger now holds them (as the database would return them, with scale).
        const existing: KnownTransaction[] = inserted.map((t) => ({
          ...t,
          quantity: `${t.quantity}.0000000000`,
          unit_price: `${t.unit_price}00000000`,
        }));
        const second = dryRun(HEADER, csv, {}, [FII], existing, PACKS);
        if (!second.ok) throw new Error("dry run failed");
        expect(second.rows.every((r) => r.duplicate)).toBe(true);
        expect(planCommit(second, second.previewHash, new Set())).toEqual({ ok: false, reason: "nothing_to_import" });
      }),
    );
  });
});
