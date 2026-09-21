import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/calc/dates";
import { KernelDecimal } from "@/lib/calc/decimal";
import { BACKUP_VERSION, parseBackup, type Backup } from "./schema";
import { canonicalBackup, serializeBackup } from "./serialize";

const TS = "2026-09-20T12:00:00.000000Z";
const decimal = fc.integer({ min: 1, max: 10_000_000 }).map((n) => new KernelDecimal(n).div(100).toFixed());
const signed = fc
  .integer({ min: -10_000_000, max: 10_000_000 })
  .filter((n) => n !== 0)
  .map((n) => new KernelDecimal(n).div(100).toFixed());
const day = fc.integer({ min: 0, max: 700 }).map((n) => addDays("2025-01-01", n));
const currency = fc.constantFrom("BRL", "USD", "GBP");

const backupArb: fc.Arbitrary<Backup> = fc
  .array(fc.uuid(), { minLength: 1, maxLength: 4 })
  .chain((assetIds) =>
    fc.record({
      settings: fc.option(
        fc.record({
          base_currency: currency,
          enabled_packs: fc.constantFrom([], ["br"], ["br", "global"]),
          locale: fc.constantFrom("pt-BR", "en-GB"),
          theme: fc.constantFrom("system", "light", "dark"),
        }),
        { nil: null },
      ),
      assets: fc.constant(
        assetIds.map((id, i) => ({
          id,
          pack_id: "br",
          instrument_kind: "br.fii",
          identifier: `T${i}`,
          name: `Asset ${i}`,
          native_currency: "BRL",
          metadata: { fundName: `Fund ${i}` },
          created_at: TS,
          updated_at: TS,
        })),
      ),
      transactions: fc.array(
        fc.record({
          id: fc.uuid(),
          asset_id: fc.constantFrom(...assetIds),
          trade_date: day,
          type: fc.constantFrom("buy", "sell", "dividend", "interest", "fee"),
          quantity: signed,
          unit_price: decimal,
          currency,
          fees: decimal,
          fx_rate: fc.option(decimal, { nil: null }),
          note: fc.option(fc.string({ maxLength: 12 }), { nil: null }),
          created_at: fc.constant(TS),
        }),
        { maxLength: 6 },
      ),
      cash_flows: fc.array(
        fc.record({
          id: fc.uuid(),
          date: day,
          amount: signed,
          currency,
          note: fc.constant(null),
          created_at: fc.constant(TS),
        }),
        { maxLength: 4 },
      ),
      prices: fc
        .uniqueArray(fc.tuple(fc.constantFrom(...assetIds), day), { maxLength: 8, selector: ([a, d]) => `${a}|${d}` })
        .chain((keys) =>
          fc.tuple(
            ...keys.map(([asset_id, date]) =>
              fc.record({
                asset_id: fc.constant(asset_id),
                date: fc.constant(date),
                price: decimal,
                currency,
                source_id: fc.constantFrom("manual", "br.brapi"),
              }),
            ),
          ),
        )
        .map((rows) => [...rows]),
    }),
  )
  .map((b) => ({ version: BACKUP_VERSION, exported_at: TS, ...b }) as Backup);

describe("parseBackup", () => {
  it("checks the version before the shape, with fixed reasons", () => {
    expect(parseBackup({ version: 2 })).toMatchObject({ ok: false, reason: "unsupported_version" });
    expect(parseBackup(null)).toMatchObject({ ok: false, reason: "unsupported_version" });
    expect(parseBackup({ version: 1 })).toMatchObject({ ok: false, reason: "invalid_backup" });
    const bad = parseBackup({
      version: 1,
      exported_at: TS,
      settings: null,
      assets: [],
      transactions: [],
      cash_flows: [],
      prices: [{ asset_id: "x", date: "2026-01-01", price: 1, currency: "BRL", source_id: "manual" }],
    });
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.join(" ")).toMatch(/prices\.0/);
  });

  it("property: parseBackup(serialize(x)) deep-equals the canonical form of x", () => {
    fc.assert(
      fc.property(backupArb, (b) => {
        const parsed = parseBackup(JSON.parse(serializeBackup(b)));
        expect(parsed.ok).toBe(true);
        if (parsed.ok) expect(parsed.backup).toEqual(canonicalBackup(b));
      }),
    );
  });
});

describe("serializeBackup", () => {
  it("is byte-identical across row order and non-canonical decimals", () => {
    fc.assert(
      fc.property(backupArb, (b) => {
        const shuffled: Backup = {
          ...b,
          assets: [...b.assets].reverse(),
          transactions: [...b.transactions].reverse(),
          cash_flows: [...b.cash_flows].reverse(),
          prices: [...b.prices]
            .reverse()
            .map((p) => ({ ...p, price: `${p.price}${p.price.includes(".") ? "00" : ".000"}` })),
        };
        expect(serializeBackup(shuffled)).toBe(serializeBackup(b));
      }),
    );
  });

  it("orders keys as the schema lists them and ends with a newline", () => {
    const b: Backup = {
      version: 1,
      exported_at: TS,
      settings: null,
      assets: [],
      transactions: [],
      cash_flows: [],
      prices: [],
    };
    expect(serializeBackup(b)).toBe(
      `{\n  "version": 1,\n  "exported_at": "${TS}",\n  "settings": null,\n  "assets": [],\n  "transactions": [],\n  "cash_flows": [],\n  "prices": []\n}\n`,
    );
  });
});
