import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { abortedSignal, testContext, textResponse } from "../../conformance/helpers";
import { FetchPointSchema } from "../../schema";
import { fetchBcbPtax, parsePtaxCsv, toOlindaDate } from "./bcb-ptax";

const HEADER = "cotacaoCompra,cotacaoVenda,dataHoraCotacao";
const BODY = [
  HEADER,
  '"5,1564","5,157",2026-09-01 13:06:03.857125',
  '"5,1267","5,1273",2026-09-02 13:02:37.601302',
].join("\n");

const ctx = (status: number, body: string, calls: string[] = []) =>
  testContext({ get: (url) => (calls.push(url), textResponse(status, body)) });

const req = { capability: "fx" as const, refs: ["global.usdbrl"], from: "2026-09-01", to: "2026-09-02" };

describe("bcb-ptax adapter", () => {
  it("requests CSV over MM-DD-YYYY bounds and emits cotacaoVenda as an exact BRL decimal string", async () => {
    const calls: string[] = [];
    const r = await fetchBcbPtax(req, ctx(200, BODY, calls));
    expect(calls[0]).toBe(
      "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
        "CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)" +
        "?@dataInicial='09-01-2026'&@dataFinalCotacao='09-02-2026'&$format=text/csv",
    );
    expect(r.points).toEqual([
      { ref: "global.usdbrl", date: "2026-09-01", value: "5.157", currency: "BRL" },
      { ref: "global.usdbrl", date: "2026-09-02", value: "5.1273", currency: "BRL" },
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.coverage).toEqual([
      {
        ref: "global.usdbrl",
        requested: { from: "2026-09-01", to: "2026-09-02" },
        returned: { from: "2026-09-01", to: "2026-09-02" },
        complete: true,
      },
    ]);
  });

  it("reads the ask (cotacaoVenda), not the bid, by header name rather than position", async () => {
    // Same data, columns reordered: a positional reader would return the bid.
    const swapped = ["dataHoraCotacao,cotacaoVenda,cotacaoCompra", '2026-09-01 13:06:03,"5,157","5,1564"'].join("\n");
    const r = await fetchBcbPtax(req, ctx(200, swapped));
    expect(r.points[0].value).toBe("5.157");
  });

  it("treats a header-only body as a genuine empty window and certifies it", async () => {
    const r = await fetchBcbPtax(req, ctx(200, `${HEADER}\n`));
    expect(r.points).toEqual([]);
    expect(r.coverage?.[0]).toMatchObject({ returned: null, complete: true });
  });

  it("refuses an unexpected header instead of silently returning nothing", async () => {
    const r = await fetchBcbPtax(req, ctx(200, "a,b,c\n1,2,3"));
    expect(r.points).toEqual([]);
    expect(r.coverage?.[0].complete).toBe(false);
    expect(r.warnings[0]).toMatch(/CSV header/);
  });

  it("never certifies a window behind a non-200 or a transport failure", async () => {
    for (const c of [ctx(500, "boom"), ctx(429, "slow down")]) {
      const r = await fetchBcbPtax(req, c);
      expect(r.points).toEqual([]);
      expect(r.coverage?.[0].complete).toBe(false);
    }
    const thrown = await fetchBcbPtax(
      req,
      testContext({
        get: () => {
          throw new Error("aborted");
        },
      }),
    );
    expect(thrown.coverage?.[0].complete).toBe(false);
    expect(thrown.warnings[0]).toBe("bcb_ptax: request failed");
  });

  it("skips malformed rows, counts them, and keeps the window uncertified only when the header is wrong", async () => {
    const r = await fetchBcbPtax(req, ctx(200, [HEADER, '"nope","nope",2026-09-01 13:00:00', '"5,10","5,11",bad-date'].join("\n")));
    expect(r.points).toEqual([]);
    expect(r.warnings.some((w) => /skipped 2 unparsable/.test(w))).toBe(true);
  });

  it("keeps the latest quote deterministically if a date ever repeats", async () => {
    const dup = [HEADER, '"5,00","5,01",2026-09-01 10:00:00', '"5,00","5,09",2026-09-01 13:00:00'].join("\n");
    const forward = await fetchBcbPtax(req, ctx(200, dup));
    const reversed = await fetchBcbPtax(
      req,
      ctx(200, [HEADER, '"5,00","5,09",2026-09-01 13:00:00', '"5,00","5,01",2026-09-01 10:00:00'].join("\n")),
    );
    expect(forward.points).toEqual(reversed.points);
    expect(forward.points).toEqual([{ ref: "global.usdbrl", date: "2026-09-01", value: "5.09", currency: "BRL" }]);
    expect(forward.warnings.some((w) => /duplicate date/.test(w))).toBe(true);
  });

  it("drops rows outside the requested window", async () => {
    const r = await fetchBcbPtax(req, ctx(200, [HEADER, '"5,00","5,01",2026-08-28 13:00:00', '"5,00","5,02",2026-09-01 13:00:00'].join("\n")));
    expect(r.points.map((p) => p.date)).toEqual(["2026-09-01"]);
  });

  it("makes no request once the budget signal has aborted", async () => {
    const calls: string[] = [];
    const r = await fetchBcbPtax(
      req,
      testContext({ signal: abortedSignal(), get: (url) => (calls.push(url), textResponse(200, BODY)) }),
    );
    expect(calls).toEqual([]);
    expect(r.coverage?.[0].complete).toBe(false);
    expect(r.warnings[0]).toMatch(/budget/);
  });

  it("warns on an unknown ref and a wrong capability without requesting anything", async () => {
    const calls: string[] = [];
    const unknown = await fetchBcbPtax({ ...req, refs: ["global.eurbrl"] }, ctx(200, BODY, calls));
    expect(calls).toEqual([]);
    expect(unknown.warnings[0]).toMatch(/no PTAX mapping/);
    expect(unknown.coverage?.map((c) => c.ref)).toEqual(["global.eurbrl"]);

    const wrong = await fetchBcbPtax({ ...req, capability: "series" }, ctx(200, BODY, calls));
    expect(calls).toEqual([]);
    expect(wrong.warnings[0]).toMatch(/only supports/);
  });

  it("serves 'historical' with the same contract as 'fx'", async () => {
    const r = await fetchBcbPtax({ ...req, capability: "historical" }, ctx(200, BODY));
    expect(r.points).toHaveLength(2);
    expect(r.coverage?.[0].complete).toBe(true);
  });

  it("maps ISO dates to Olinda's MM-DD-YYYY order", () => {
    expect(toOlindaDate("2026-09-01")).toBe("09-01-2026");
    expect(toOlindaDate("1999-12-31")).toBe("12-31-1999");
  });

  it("property: every emitted point satisfies the kernel output contract", async () => {
    const row = fc
      .tuple(
        fc.date({ min: new Date("2000-01-03"), max: new Date("2026-09-06"), noInvalidDate: true }),
        fc.nat(99),
        fc.nat(9999),
      )
      .map(([d, w, f]) => `"0,00","${w},${String(f).padStart(4, "0")}",${d.toISOString().slice(0, 10)} 13:00:00`);
    await fc.assert(
      fc.asyncProperty(fc.array(row, { maxLength: 30 }), async (rows) => {
        const r = await fetchBcbPtax(
          { capability: "fx", refs: ["global.usdbrl"], from: "2000-01-01", to: "2026-09-06" },
          ctx(200, [HEADER, ...rows].join("\n")),
        );
        for (const p of r.points) {
          expect(FetchPointSchema.safeParse(p).success).toBe(true);
          expect(p.currency).toBe("BRL");
          expect(p.tenorDays).toBeUndefined();
        }
        // The primary key (ref, date) must be unique inside one result.
        const keys = r.points.map((p) => `${p.ref}|${p.date}`);
        expect(new Set(keys).size).toBe(keys.length);
      }),
    );
  });
});

describe("parsePtaxCsv", () => {
  it("signals a broken contract with malformed = -1 rather than an empty success", () => {
    expect(parsePtaxCsv("").malformed).toBe(-1);
    expect(parsePtaxCsv("cotacaoCompra,dataHoraCotacao\n").malformed).toBe(-1);
  });

  it("tolerates CRLF and a trailing blank line", () => {
    const { rows, malformed } = parsePtaxCsv(`${HEADER}\r\n"5,1564","5,157",2026-09-01 13:06:03\r\n\r\n`);
    expect(malformed).toBe(0);
    expect(rows).toEqual([{ date: "2026-09-01", value: "5.157", observedAt: "2026-09-01 13:06:03" }]);
  });
});
