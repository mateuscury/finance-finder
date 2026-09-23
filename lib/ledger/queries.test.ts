import { describe, expect, it } from "vitest";
import { PACKS } from "@/packs";
import { fakeClient } from "@/lib/testing/fake-client";
import { countLedger, listAssets, listCashFlows, listTransactions } from "./queries";

const asset = (id: string, kind: string, identifier: string) => ({
  id,
  pack_id: "br",
  instrument_kind: kind,
  identifier,
  name: identifier,
  native_currency: "BRL",
  metadata: {},
});

describe("listAssets", () => {
  it("joins the latest price and, for an unpriced market asset, the source's last error (SPEC §9.4)", async () => {
    const { client } = fakeClient({
      assets: {
        select: {
          data: [
            asset("a1", "br.fii", "HGLG11"),
            asset("a2", "br.fii", "KNRI11"),
            asset("a3", "br.cdb", "cdb-x"),
            asset("a4", "br.nope", "?"),
          ],
        },
      },
      asset_latest_prices: {
        select: {
          data: [{ asset_id: "a1", date: "2026-02-27", price: "162.40", currency: "BRL", source_id: "br.brapi" }],
        },
      },
      ingest_cursors: { select: { data: [{ source_id: "br.brapi", last_error: "429" }] } },
    });
    const rows = await listAssets(client, PACKS);
    expect(rows.map((r) => [r.id, r.valuation, r.sourceId, r.latest?.price ?? null, r.sourceError])).toEqual([
      ["a1", "market_price", "br.brapi", "162.40", null],
      ["a2", "market_price", "br.brapi", null, "429"],
      ["a3", "accrual", null, null, null],
      ["a4", null, null, null, null],
    ]);
    expect(rows[3].kindLabel).toBeNull();
  });

  it("returns nothing for an empty ledger without reading prices", async () => {
    const { client, calls } = fakeClient({ assets: { select: { data: [] } } });
    expect(await listAssets(client, PACKS)).toEqual([]);
    expect(calls.map((c) => c.table)).toEqual(["assets"]);
  });
});

describe("pages and counts", () => {
  it("listTransactions maps the embedded asset whether PostgREST returns an object or a one-element array", async () => {
    const t = (id: string, assets: unknown) => ({
      id,
      asset_id: "a1",
      trade_date: "2026-02-02",
      type: "buy",
      quantity: "1",
      unit_price: "1",
      currency: "BRL",
      fees: "0",
      fx_rate: null,
      assets,
    });
    const { client } = fakeClient({
      transactions: {
        select: {
          data: [
            t("t1", { identifier: "HGLG11", name: "CSHG" }),
            t("t2", [{ identifier: "KNRI11", name: "Kinea" }]),
            t("t3", null),
          ],
          count: 3,
        },
      },
    });
    const page = await listTransactions(client, 1);
    expect(page.total).toBe(3);
    expect(page.rows.map((r) => r.identifier)).toEqual(["HGLG11", "KNRI11", "?"]);
    expect(page.rows[0]).not.toHaveProperty("assets");
  });

  it("listCashFlows pages and countLedger counts with head requests", async () => {
    const { client, calls } = fakeClient({
      cash_flows: {
        select: { data: [{ id: "c1", date: "2026-01-15", amount: "20000", currency: "BRL", note: null }], count: 1 },
      },
      assets: { select: { count: 2 } },
      transactions: { select: { count: 5 } },
    });
    expect((await listCashFlows(client, 2)).page).toBe(2);
    const counts = await countLedger(client);
    expect(counts).toEqual({ assets: 2, transactions: 5, cashFlows: 1 });
    expect(calls.filter((c) => c.op === "select").every((c) => c.table)).toBe(true);
  });

  it("throws a code-only message when a page read fails", async () => {
    const { client } = fakeClient({
      transactions: { select: { error: { code: "42501", message: "permission denied for secret_table" } } },
    });
    await expect(listTransactions(client)).rejects.toThrow(/^ledger: transactions page \(42501\)$/);
  });
});

describe("listTransactions filters (decision 64)", () => {
  const rows = [
    {
      id: "t1",
      asset_id: "a1",
      trade_date: "2026-01-05",
      type: "sell",
      quantity: "-1",
      unit_price: "1",
      currency: "BRL",
      fees: "0",
      fx_rate: null,
      assets: { identifier: "HGLG11", name: "HGLG11" },
    },
  ];

  it("applies asset, type and both dates as database filters, and pages the filtered count", async () => {
    const { client, calls } = fakeClient({ transactions: { select: { data: rows, count: 140 } } });
    const page = await listTransactions(client, 2, {
      asset: "11111111-1111-4111-8111-111111111111",
      type: "sell",
      from: "2026-01-01",
      to: "2026-06-30",
    });
    expect(calls[0].filters).toEqual([
      ["asset_id", "eq", "11111111-1111-4111-8111-111111111111"],
      ["type", "eq", "sell"],
      ["trade_date", "gte", "2026-01-01"],
      ["trade_date", "lte", "2026-06-30"],
    ]);
    // The count is the FILTERED count — what the pager and the "n match" line use.
    expect(page.total).toBe(140);
    expect(page.page).toBe(2);
  });

  it("issues no filter at all when none is set", async () => {
    const { client, calls } = fakeClient({ transactions: { select: { data: rows, count: 1 } } });
    await listTransactions(client);
    expect(calls[0].filters).toEqual([]);
  });
});
