import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { abortedSignal, jsonResponse, testContext, textResponse } from "../../conformance/helpers";
import type { FetchContext } from "../../types";
import { fetchBcbSgs, percentagePointsToUnitRate } from "./bcb-sgs";

function ctxWith(status: number, body: unknown, calls: string[] = []): FetchContext {
  return testContext({
    now: "2025-06-30T12:00:00Z",
    get: (url) => (calls.push(url), jsonResponse(status, body)),
  });
}

describe("bcb-sgs adapter", () => {
  it("builds the SGS URL with dd/MM/yyyy bounds and maps rows to ISO-dated decimal strings", async () => {
    const calls: string[] = [];
    const ctx = ctxWith(200, [{ data: "02/01/2025", valor: "0.045513" }], calls);
    const r = await fetchBcbSgs({ capability: "series", refs: ["br.cdi"], from: "2025-01-02", to: "2025-01-03" }, ctx);
    expect(calls[0]).toBe(
      "https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=02/01/2025&dataFinal=03/01/2025",
    );
    expect(r.points).toEqual([{ ref: "br.cdi", date: "2025-01-02", value: "0.00045513", currency: null }]);
    expect(r.warnings).toEqual([]);
    expect(r.coverage).toEqual([
      {
        ref: "br.cdi",
        requested: { from: "2025-01-02", to: "2025-01-03" },
        returned: { from: "2025-01-02", to: "2025-01-02" },
        complete: true,
      },
    ]);
  });

  it("normalizes percentage points exactly without using floating-point math", () => {
    expect(percentagePointsToUnitRate("0.045513")).toBe("0.00045513");
    expect(percentagePointsToUnitRate("1")).toBe("0.01");
    expect(percentagePointsToUnitRate("100.00")).toBe("1");
    expect(percentagePointsToUnitRate("-0.25")).toBe("-0.0025");
    expect(percentagePointsToUnitRate("NaN")).toBeNull();
  });

  it("fails safely instead of storing SGS 433 percentage changes as IPCA index levels", async () => {
    const calls: string[] = [];
    const r = await fetchBcbSgs(
      { capability: "series", refs: ["br.ipca"] },
      ctxWith(200, [{ data: "01/06/2025", valor: "0.24" }], calls),
    );
    expect(calls).toEqual([]);
    expect(r.points).toEqual([]);
    expect(r.warnings[0]).toMatch(/disabled.*index level/);
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
      // noInvalidDate: fast-check 4 emits `Invalid Date` by default, and toISOString() then throws.
      data: fc.date({ min: new Date("1990-01-01"), max: new Date("2025-06-30"), noInvalidDate: true }).map((d) => {
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

describe("bcb-sgs budget and coverage contract", () => {
  it("certifies an empty window as checked so the scheduler stops re-requesting a holiday", async () => {
    const r = await fetchBcbSgs(
      { capability: "series", refs: ["br.cdi"], from: "2025-01-01", to: "2025-01-01" },
      ctxWith(200, []),
    );
    expect(r.points).toEqual([]);
    expect(r.coverage).toEqual([
      {
        ref: "br.cdi",
        requested: { from: "2025-01-01", to: "2025-01-01" },
        returned: null,
        complete: true,
      },
    ]);
  });

  it("never certifies a window it could not read", async () => {
    for (const ctx of [ctxWith(503, "unavailable"), ctxWith(200, { not: "an array" })]) {
      const r = await fetchBcbSgs(
        { capability: "series", refs: ["br.cdi"], from: "2025-01-02", to: "2025-01-03" },
        ctx,
      );
      expect(r.coverage?.[0]).toMatchObject({ returned: null, complete: false });
    }
  });

  it("makes no request and covers nothing once the budget signal has aborted", async () => {
    const calls: string[] = [];
    const r = await fetchBcbSgs(
      { capability: "series", refs: ["br.cdi", "br.selic"], from: "2025-01-02", to: "2025-01-03" },
      testContext({
        now: "2025-06-30T12:00:00Z",
        signal: abortedSignal(),
        get: (url) => (calls.push(url), jsonResponse(200, [])),
      }),
    );
    expect(calls).toEqual([]);
    expect(r.points).toEqual([]);
    expect(r.coverage?.every((c) => c.complete === false)).toBe(true);
    expect(r.warnings.some((w) => /budget/.test(w))).toBe(true);
  });

  it("keeps a finished ref's points when a later ref's request fails, and reports each honestly", async () => {
    let n = 0;
    const r = await fetchBcbSgs(
      { capability: "series", refs: ["br.cdi", "br.selic"], from: "2025-01-02", to: "2025-01-02" },
      testContext({
        now: "2025-06-30T12:00:00Z",
        get: () => {
          if (n++ === 0) return jsonResponse(200, [{ data: "02/01/2025", valor: "0.045513" }]);
          throw new Error("aborted");
        },
      }),
    );
    expect(r.points.map((p) => p.ref)).toEqual(["br.cdi"]);
    expect(r.coverage?.find((c) => c.ref === "br.cdi")?.complete).toBe(true);
    expect(r.coverage?.find((c) => c.ref === "br.selic")).toMatchObject({ returned: null, complete: false });
  });

  it("emits one coverage entry per requested ref even when a ref is unknown", async () => {
    const r = await fetchBcbSgs(
      { capability: "series", refs: ["br.cdi", "br.nope", "br.ipca"], from: "2025-01-02", to: "2025-01-02" },
      ctxWith(200, []),
    );
    expect(r.coverage?.map((c) => c.ref)).toEqual(["br.cdi", "br.nope", "br.ipca"]);
    expect(r.coverage?.find((c) => c.ref === "br.ipca")?.complete).toBe(false);
  });

  it("reports the wrong capability without covering anything", async () => {
    const r = await fetchBcbSgs(
      { capability: "spot", refs: ["br.cdi"], from: "2025-01-02", to: "2025-01-02" },
      ctxWith(200, []),
    );
    expect(r.coverage?.[0].complete).toBe(false);
    expect(r.warnings).toHaveLength(1);
  });
});

describe("bcb-sgs empty-window contract (SGS answers 404, not 200 [])", () => {
  const notFound =
    '{"erro":{"statusCode":404,"detail":"br.gov.bcb.pec.sgs.comum.excecoes.SGSNegocioException: Value(s) not found"}}';

  it("certifies a 404 'Value(s) not found' window as genuinely empty", async () => {
    // Without this, a weekend run would never advance the CDI watermark and
    // would re-request the same empty window every night.
    const r = await fetchBcbSgs(
      { capability: "series", refs: ["br.cdi"], from: "2026-09-05", to: "2026-09-06" },
      testContext({ now: "2026-09-06T12:00:00Z", get: () => textResponse(404, notFound) }),
    );
    expect(r.points).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.coverage?.[0]).toMatchObject({ returned: null, complete: true });
  });

  it("still refuses to certify a 404 that is not the empty-window exception", async () => {
    const r = await fetchBcbSgs(
      { capability: "series", refs: ["br.cdi"], from: "2026-09-05", to: "2026-09-06" },
      testContext({ now: "2026-09-06T12:00:00Z", get: () => textResponse(404, '{"erro":"gone"}') }),
    );
    expect(r.coverage?.[0].complete).toBe(false);
    expect(r.warnings[0]).toMatch(/HTTP 404/);
  });
});
