import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { abortedSignal, jsonResponse, testContext } from "../../conformance/helpers";
import { FetchPointSchema } from "../../schema";
import { fetchIbgeSidra, lastDayOfMonth, monthsBetween, periodToMonthEnd } from "./ibge-sidra";

const row = (period: string, value: string) => ({
  NC: "1",
  NN: "Brasil",
  MN: "Número-índice",
  V: value,
  D1C: "1",
  D2C: "2266",
  D3C: period,
  D3N: period,
});

const ctx = (status: number, body: unknown, calls: string[] = []) =>
  testContext({ now: "2026-09-06T12:00:00Z", get: (url) => (calls.push(url), jsonResponse(status, body)) });

const req = { capability: "series" as const, refs: ["br.ipca"], from: "2026-01-01", to: "2026-03-31" };

describe("ibge-sidra adapter", () => {
  it("requests table 1737 / variable 2266 over a YYYYMM range with the label row suppressed", async () => {
    const calls: string[] = [];
    await fetchIbgeSidra(req, ctx(200, [], calls));
    expect(calls[0]).toBe("https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/2266/p/202601-202603/h/n");
  });

  it("dates each monthly level on the last calendar day and keeps the level exact", async () => {
    const r = await fetchIbgeSidra(
      req,
      ctx(200, [
        row("202601", "7427.7200000000000"),
        row("202602", "7479.7100000000000"),
        row("202603", "7545.5300000000000"),
      ]),
    );
    expect(r.points).toEqual([
      { ref: "br.ipca", date: "2026-01-31", value: "7427.72", currency: null },
      { ref: "br.ipca", date: "2026-02-28", value: "7479.71", currency: null },
      { ref: "br.ipca", date: "2026-03-31", value: "7545.53", currency: null },
    ]);
    expect(r.warnings).toEqual([]);
    expect(r.coverage?.[0]).toMatchObject({ complete: true, returned: { from: "2026-01-31", to: "2026-03-31" } });
  });

  it("performs no chaining: it emits the published level, not a derived one", async () => {
    // Two consecutive months whose ratio is a round 1%. A chaining adapter
    // would emit a variation; this one must emit both levels verbatim.
    const r = await fetchIbgeSidra(req, ctx(200, [row("202601", "100.00"), row("202602", "101.00")]));
    expect(r.points.map((p) => p.value)).toEqual(["100", "101"]);
  });

  it("rejects SIDRA's unavailable/confidential placeholders instead of coercing them", async () => {
    const r = await fetchIbgeSidra(req, ctx(200, [row("202601", "..."), row("202602", "-"), row("202603", "X")]));
    expect(r.points).toEqual([]);
    expect(r.warnings.some((w) => /rejected 3 row/.test(w))).toBe(true);
  });

  it("skips SIDRA's label row without counting it as data loss of a real month", async () => {
    const label = { V: "Valor", D3C: "Mês (Código)", D3N: "Mês" };
    const r = await fetchIbgeSidra(req, ctx(200, [label, row("202601", "7427.72")]));
    expect(r.points).toHaveLength(1);
    expect(r.warnings.some((w) => /rejected 1 row/.test(w))).toBe(true);
  });

  it("treats an unpublished period as a genuine empty window and certifies it", async () => {
    const r = await fetchIbgeSidra(req, ctx(200, []));
    expect(r.points).toEqual([]);
    expect(r.coverage?.[0]).toMatchObject({ returned: null, complete: true });
  });

  it("refuses to certify when a published month ends past the requested window", async () => {
    // Asking to 2026-03-20 while March's level exists: the month-end anchor is
    // 2026-03-31, outside the window. Advancing the watermark here would step
    // over a level that was published but never stored.
    const r = await fetchIbgeSidra(
      { ...req, to: "2026-03-20" },
      ctx(200, [row("202601", "7427.72"), row("202603", "7545.53")]),
    );
    expect(r.points.map((p) => p.date)).toEqual(["2026-01-31"]);
    expect(r.coverage?.[0].complete).toBe(false);
    expect(r.warnings.some((w) => /after the requested window/.test(w))).toBe(true);
  });

  it("drops months before the requested window without disturbing coverage", async () => {
    const r = await fetchIbgeSidra({ ...req, from: "2026-02-01" }, ctx(200, [row("202601", "1"), row("202602", "2")]));
    expect(r.points.map((p) => p.date)).toEqual(["2026-02-28"]);
    expect(r.coverage?.[0].complete).toBe(true);
  });

  it("never certifies a window behind a non-200, a bad payload or a transport failure", async () => {
    for (const c of [ctx(500, ""), ctx(429, ""), ctx(200, { not: "an array" })]) {
      const r = await fetchIbgeSidra(req, c);
      expect(r.points).toEqual([]);
      expect(r.coverage?.[0].complete).toBe(false);
    }
    const thrown = await fetchIbgeSidra(
      req,
      testContext({
        get: () => {
          throw new Error("aborted");
        },
      }),
    );
    expect(thrown.coverage?.[0].complete).toBe(false);
  });

  it("makes no request once the budget signal has aborted", async () => {
    const calls: string[] = [];
    const r = await fetchIbgeSidra(
      req,
      testContext({ signal: abortedSignal(), get: (url) => (calls.push(url), jsonResponse(200, [])) }),
    );
    expect(calls).toEqual([]);
    expect(r.coverage?.[0].complete).toBe(false);
  });

  it("warns on an unknown ref and a wrong capability without requesting anything", async () => {
    const calls: string[] = [];
    expect((await fetchIbgeSidra({ ...req, refs: ["br.igpm"] }, ctx(200, [], calls))).warnings[0]).toMatch(
      /no SIDRA mapping/,
    );
    expect((await fetchIbgeSidra({ ...req, capability: "spot" }, ctx(200, [], calls))).warnings[0]).toMatch(
      /only supports/,
    );
    expect(calls).toEqual([]);
  });

  it("keeps the last value deterministically if a period ever repeats", async () => {
    const r = await fetchIbgeSidra(req, ctx(200, [row("202601", "100"), row("202601", "101")]));
    expect(r.points).toEqual([{ ref: "br.ipca", date: "2026-01-31", value: "101", currency: null }]);
  });
});

describe("SIDRA month dating", () => {
  it("computes month ends including leap-year February", () => {
    expect(lastDayOfMonth(2024, 2)).toBe(29);
    expect(lastDayOfMonth(2026, 2)).toBe(28);
    expect(lastDayOfMonth(1900, 2)).toBe(28); // century, not a leap year
    expect(lastDayOfMonth(2000, 2)).toBe(29); // 400-year exception
    expect(lastDayOfMonth(2026, 4)).toBe(30);
    expect(lastDayOfMonth(2026, 12)).toBe(31);
  });

  it("maps YYYYMM to the last calendar day, and rejects malformed periods", () => {
    expect(periodToMonthEnd("202605")).toBe("2026-05-31");
    expect(periodToMonthEnd("202402")).toBe("2024-02-29");
    for (const bad of ["", "2026", "202613", "202600", "Mês (Código)", "20260a"]) {
      expect(periodToMonthEnd(bad), bad).toBeNull();
    }
  });

  it("spans months inclusively across a year boundary", () => {
    expect(monthsBetween("2025-11-15", "2026-02-03")).toEqual(["202511", "202512", "202601", "202602"]);
    expect(monthsBetween("2026-01-01", "2026-01-31")).toEqual(["202601"]);
  });

  it("property: every emitted point satisfies the kernel output contract", async () => {
    const rows = fc.array(
      fc.tuple(fc.integer({ min: 2000, max: 2026 }), fc.integer({ min: 1, max: 12 }), fc.nat(999999)),
      { maxLength: 30 },
    );
    await fc.assert(
      fc.asyncProperty(rows, async (triples) => {
        const body = triples.map(([y, m, v]) => row(`${y}${String(m).padStart(2, "0")}`, `${v + 1}.00`));
        const r = await fetchIbgeSidra(
          { capability: "series", refs: ["br.ipca"], from: "2000-01-01", to: "2026-12-31" },
          ctx(200, body),
        );
        for (const p of r.points) {
          expect(FetchPointSchema.safeParse(p).success).toBe(true);
          expect(p.currency).toBeNull();
          expect(p.tenorDays).toBeUndefined();
        }
        const keys = r.points.map((p) => `${p.ref}|${p.date}`);
        expect(new Set(keys).size).toBe(keys.length);
      }),
    );
  });
});
