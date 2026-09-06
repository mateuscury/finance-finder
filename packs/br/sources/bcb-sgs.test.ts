import fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { FetchContext, PackHttpResponse } from "../../types";
import { fetchBcbSgs } from "./bcb-sgs";

function ctxWith(status: number, body: unknown, calls: string[] = []): FetchContext {
  const res: PackHttpResponse = {
    status,
    headers: {},
    text: async () => JSON.stringify(body),
    json: async () => body,
  };
  return {
    http: { get: async (url) => (calls.push(url), res) },
    env: {},
    now: () => new Date("2025-06-30T12:00:00Z"),
    log: () => {},
  };
}

describe("bcb-sgs adapter", () => {
  it("builds the SGS URL with dd/MM/yyyy bounds and maps rows to ISO-dated decimal strings", async () => {
    const calls: string[] = [];
    const ctx = ctxWith(200, [{ data: "02/01/2025", valor: "0.045513" }], calls);
    const r = await fetchBcbSgs({ capability: "series", refs: ["br.cdi"], from: "2025-01-02", to: "2025-01-03" }, ctx);
    expect(calls[0]).toBe(
      "https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=02/01/2025&dataFinal=03/01/2025",
    );
    expect(r.points).toEqual([{ ref: "br.cdi", date: "2025-01-02", value: "0.045513", currency: null }]);
    expect(r.warnings).toEqual([]);
  });

  it("warns instead of throwing on unknown refs, wrong capability and upstream errors", async () => {
    expect((await fetchBcbSgs({ capability: "spot", refs: ["br.cdi"] }, ctxWith(200, []))).warnings).toHaveLength(1);
    expect((await fetchBcbSgs({ capability: "series", refs: ["br.nope"] }, ctxWith(200, []))).warnings).toHaveLength(1);
    const r = await fetchBcbSgs({ capability: "series", refs: ["br.cdi"] }, ctxWith(503, "unavailable"));
    expect(r.points).toEqual([]);
    expect(r.warnings[0]).toMatch(/HTTP 503/);
  });

  it("property: every emitted point satisfies the output contract for any well-formed payload", async () => {
    const row = fc.record({
      data: fc.date({ min: new Date("1990-01-01"), max: new Date("2025-06-30") }).map((d) => {
        const iso = d.toISOString().slice(0, 10);
        const [y, m, dd] = iso.split("-");
        return `${dd}/${m}/${y}`;
      }),
      valor: fc.tuple(fc.nat(999), fc.nat(999999)).map(([i, f]) => `${i}.${String(f).padStart(6, "0")}`),
    });
    await fc.assert(
      fc.asyncProperty(fc.array(row, { maxLength: 50 }), async (rows) => {
        const r = await fetchBcbSgs({ capability: "series", refs: ["br.selic"] }, ctxWith(200, rows));
        expect(r.points).toHaveLength(rows.length);
        for (const p of r.points) {
          expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
          expect(p.date <= "2025-06-30").toBe(true);
          expect(p.value).toMatch(/^-?\d+(\.\d+)?$/);
          expect(typeof p.value).toBe("string");
          expect(p.currency).toBeNull();
        }
      }),
    );
  });
});
