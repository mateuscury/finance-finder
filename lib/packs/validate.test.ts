import { describe, expect, it } from "vitest";
import type { FetchPoint, InstrumentKind, SeriesDescriptor } from "@/packs/types";
import { isPositiveDecimal, validatePoints, type ValidationScope } from "./validate";
import { z } from "zod";

const series = (id: string, kind: SeriesDescriptor["kind"]): SeriesDescriptor => ({
  id,
  label: id,
  kind,
  sourceId: "br.x",
  roles: [],
});

const instrument = (id: string, quoteCurrency: string): InstrumentKind => ({
  id,
  label: id,
  valuation: { kind: "market_price", sourceId: "br.x" },
  metadataSchema: z.object({}),
  identifier: "ticker",
  quoteCurrency,
});

const SCOPE: ValidationScope = {
  series: new Map([
    ["br.cdi", series("br.cdi", { kind: "rate_daily", dayCount: "BUS/252" })],
    ["br.ipca", series("br.ipca", { kind: "inflation_index", interpolation: "linear_daily" })],
    ["br.ibovespa", series("br.ibovespa", { kind: "index_level" })],
    ["global.usdbrl", series("global.usdbrl", { kind: "fx_rate", base: "USD", quote: "BRL" })],
    ["br.curve", series("br.curve", { kind: "yield_curve", tenors: [21, 252] })],
  ]),
  instruments: new Map([["HGLG11", instrument("br.fii", "BRL")]]),
  requested: new Set(["br.cdi", "br.ipca", "br.ibovespa", "global.usdbrl", "br.curve", "HGLG11"]),
  from: "2026-09-01",
  to: "2026-09-06",
  now: "2026-09-06",
};

const p = (over: Partial<FetchPoint> & Pick<FetchPoint, "ref">): FetchPoint => ({
  date: "2026-09-02",
  value: "1.5",
  currency: null,
  ...over,
});

const only = (point: FetchPoint, scope: ValidationScope = SCOPE) => validatePoints([point], scope);
const reason = (point: FetchPoint, scope: ValidationScope = SCOPE) => only(point, scope).rejected[0]?.reason;

describe("validatePoints — accepts correct points", () => {
  it("accepts a scalar rate, an index level, an fx rate, a curve tenor and a price", () => {
    const r = validatePoints(
      [
        p({ ref: "br.cdi", value: "0.00045513" }),
        p({ ref: "br.ibovespa", value: "185147.16" }),
        p({ ref: "global.usdbrl", value: "5.157", currency: "BRL" }),
        p({ ref: "br.curve", value: "0.14", tenorDays: 252 }),
        p({ ref: "HGLG11", value: "148.3", currency: "BRL" }),
      ],
      SCOPE,
    );
    expect(r.rejected).toEqual([]);
    expect(r.accepted).toHaveLength(5);
    expect(r.ambiguousRefs.size).toBe(0);
  });

  it("accepts a zero or negative rate, which is economically real", () => {
    expect(only(p({ ref: "br.cdi", value: "0" })).accepted).toHaveLength(1);
    expect(only(p({ ref: "br.curve", value: "-0.01", tenorDays: 21 })).accepted).toHaveLength(1);
  });
});

describe("validatePoints — currency semantics", () => {
  it("requires an fx point to carry its declared quote currency", () => {
    expect(reason(p({ ref: "global.usdbrl", value: "5.1", currency: "USD" }))).toMatch(/quote currency/);
    expect(reason(p({ ref: "global.usdbrl", value: "5.1", currency: null }))).toMatch(/quote currency/);
  });

  it("forbids a currency on a scalar rate or index", () => {
    expect(reason(p({ ref: "br.cdi", currency: "BRL" }))).toMatch(/scalar series point carries no currency/);
    expect(reason(p({ ref: "br.ibovespa", currency: "BRL" }))).toMatch(/scalar series point carries no currency/);
  });

  it("requires a price to match its instrument's quote currency", () => {
    expect(reason(p({ ref: "HGLG11", currency: "USD" }))).toMatch(/instrument's quote currency/);
    expect(reason(p({ ref: "HGLG11", currency: null }))).toMatch(/instrument's quote currency/);
  });
});

describe("validatePoints — tenor semantics", () => {
  it("requires a declared tenor on a curve point", () => {
    expect(reason(p({ ref: "br.curve", value: "0.1" }))).toMatch(/no tenorDays/);
    expect(reason(p({ ref: "br.curve", value: "0.1", tenorDays: 99 }))).toMatch(/not a declared tenor/);
  });

  it("forbids a tenor on a scalar series or a price", () => {
    expect(reason(p({ ref: "br.cdi", tenorDays: 252 }))).toMatch(/only valid for a yield-curve/);
    expect(reason(p({ ref: "HGLG11", currency: "BRL", tenorDays: 252 }))).toMatch(/only valid for a yield-curve/);
  });
});

describe("validatePoints — positivity", () => {
  it("rejects a non-positive level, fx rate or price", () => {
    expect(reason(p({ ref: "br.ibovespa", value: "0" }))).toMatch(/index level must be positive/);
    expect(reason(p({ ref: "br.ipca", value: "-1" }))).toMatch(/index level must be positive/);
    expect(reason(p({ ref: "global.usdbrl", value: "0", currency: "BRL" }))).toMatch(/fx rate must be positive/);
    expect(reason(p({ ref: "HGLG11", value: "0.00", currency: "BRL" }))).toMatch(/price must be positive/);
  });

  it("isPositiveDecimal reads digits, never a float", () => {
    expect(isPositiveDecimal("0.00000001")).toBe(true);
    expect(isPositiveDecimal("0.0")).toBe(false);
    expect(isPositiveDecimal("0")).toBe(false);
    expect(isPositiveDecimal("-0.1")).toBe(false);
    expect(isPositiveDecimal("100")).toBe(true);
  });
});

describe("validatePoints — window, identity and duplicates", () => {
  it("rejects a ref that was never requested and marks the response ambiguous", () => {
    const r = only(p({ ref: "br.selic" }), { ...SCOPE, requested: new Set(["br.cdi"]) });
    expect(r.rejected[0].reason).toMatch(/not requested/);
    expect(r.ambiguousRefs.has("br.selic")).toBe(true);
  });

  it("rejects a ref matching no series or instrument", () => {
    expect(reason(p({ ref: "br.unknown" }), { ...SCOPE, requested: new Set(["br.unknown"]) })).toMatch(
      /matches no series or instrument/,
    );
  });

  it("rejects dates outside the window and in the future", () => {
    expect(reason(p({ ref: "br.cdi", date: "2026-08-31" }))).toMatch(/before the requested window/);
    expect(reason(p({ ref: "br.cdi", date: "2026-09-07" }))).toMatch(/future/);
    expect(reason(p({ ref: "br.cdi", date: "2026-09-06" }))).toBeUndefined();
  });

  it("rejects a duplicate primary key but keeps the first occurrence", () => {
    const r = validatePoints([p({ ref: "br.cdi" }), p({ ref: "br.cdi" })], SCOPE);
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected[0].reason).toMatch(/duplicate primary key/);
    expect(r.ambiguousRefs.has("br.cdi")).toBe(true);
  });

  it("treats the same date at different tenors as distinct keys", () => {
    const r = validatePoints(
      [p({ ref: "br.curve", value: "0.1", tenorDays: 21 }), p({ ref: "br.curve", value: "0.2", tenorDays: 252 })],
      SCOPE,
    );
    expect(r.accepted).toHaveLength(2);
  });

  it("rejects a structurally malformed point without throwing", () => {
    const r = validatePoints(
      [
        { ref: "br.cdi", date: "not-a-date", value: "1", currency: null } as FetchPoint,
        { ref: "br.cdi", date: "2026-09-02", value: "1e-3", currency: null } as FetchPoint,
      ],
      SCOPE,
    );
    expect(r.accepted).toEqual([]);
    expect(r.rejected.map((x) => x.reason)).toEqual(["malformed point", "malformed point"]);
  });

  it("counts and reports every rejection by index, rather than coercing", () => {
    // Distinct dates, so this isolates the currency rejection from the
    // duplicate-key check (which is evaluated first, by key).
    const r = validatePoints(
      [
        p({ ref: "br.cdi", date: "2026-09-02" }),
        p({ ref: "br.cdi", date: "2026-09-03", currency: "BRL" }),
        p({ ref: "br.cdi", date: "2026-09-04" }),
      ],
      SCOPE,
    );
    expect(r.accepted).toHaveLength(2);
    expect(r.rejected).toEqual([{ index: 1, reason: "a scalar series point carries no currency" }]);
  });
});

describe("validatePoints — an unattributable ref taints the whole response", () => {
  it("marks EVERY requested ref ambiguous when a point names a ref nobody asked for", () => {
    // Regression: previously only the offending ref was marked, and since the
    // scheduler checks ambiguity per REQUESTED ref, a 'complete' window could
    // still be recorded as ingested on the strength of a response whose points
    // could not be attributed to it.
    const r = validatePoints(
      [
        p({ ref: "br.cdi", value: "0.0004" }),
        p({ ref: "br.selic", value: "0.0004" }), // never requested
      ],
      { ...SCOPE, requested: new Set(["br.cdi", "br.ipca"]) },
    );
    expect(r.rejected.map((x) => x.reason)).toEqual(["ref was not requested"]);
    expect([...r.ambiguousRefs].sort()).toEqual(["br.cdi", "br.ipca", "br.selic"]);
  });

  it("leaves other refs alone when the only problem is a duplicate key", () => {
    // A duplicate is attributable, so it taints just its own ref.
    const r = validatePoints([p({ ref: "br.cdi" }), p({ ref: "br.cdi" }), p({ ref: "br.ibovespa", value: "100" })], {
      ...SCOPE,
      requested: new Set(["br.cdi", "br.ibovespa"]),
    });
    expect([...r.ambiguousRefs]).toEqual(["br.cdi"]);
  });
});
