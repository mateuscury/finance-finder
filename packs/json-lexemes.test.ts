import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  asArray,
  asObject,
  asString,
  parseJsonPreservingNumbers,
  RawNumber,
  rawNumber,
  safeInteger,
} from "./json-lexemes";
import { plainDecimal } from "./decimal-text";

describe("parseJsonPreservingNumbers", () => {
  it("keeps a price lexeme exactly, where JSON.parse would not", () => {
    // The canonical failure: a decimal that has no exact binary representation.
    const text = '{"close":0.1}';
    expect(rawNumber(asObject(parseJsonPreservingNumbers(text))!.close)).toBe("0.1");

    const wide = '{"close":185147.16,"volume":8300200,"open":147}';
    const o = asObject(parseJsonPreservingNumbers(wide))!;
    expect(rawNumber(o.close)).toBe("185147.16");
    expect(rawNumber(o.open)).toBe("147");
    expect(safeInteger(o.volume)).toBe(8300200);
  });

  it("preserves digits that a float round trip would lose", () => {
    const raw = "1.0000000000000000001";
    const value = rawNumber(asObject(parseJsonPreservingNumbers(`{"v":${raw}}`))!.v);
    expect(value).toBe(raw);
    // Proof that the naive route loses them.
    expect(String(JSON.parse(`{"v":${raw}}`).v)).not.toBe(raw);
  });

  it("does not mistake a key-like string literal for a real key", () => {
    // A blanket regular expression over the body would match the text inside
    // longName and read 999 as the close.
    const text = '{"longName":"fund \\"close\\":999 ltda","close":148.3}';
    const o = asObject(parseJsonPreservingNumbers(text))!;
    expect(asString(o.longName)).toBe('fund "close":999 ltda');
    expect(rawNumber(o.close)).toBe("148.3");
  });

  it("parses nested brapi-shaped payloads", () => {
    const text =
      '{"results":[{"symbol":"HGLG11","historicalDataPrice":[{"date":1788231600,"close":147},{"date":1788318000,"close":147.82}]}]}';
    const results = asArray(asObject(parseJsonPreservingNumbers(text))!.results)!;
    const bars = asArray(asObject(results[0])!.historicalDataPrice)!;
    expect(bars).toHaveLength(2);
    expect(rawNumber(asObject(bars[1])!.close)).toBe("147.82");
    expect(safeInteger(asObject(bars[0])!.date)).toBe(1788231600);
  });

  it("handles escapes, unicode, nulls, booleans and empty containers", () => {
    const o = asObject(parseJsonPreservingNumbers('{"a":"x\\u00e3y\\n","b":null,"c":true,"d":[],"e":{}}'))!;
    expect(asString(o.a)).toBe("xãy\n");
    expect(o.b).toBeNull();
    expect(o.c).toBe(true);
    expect(asArray(o.d)).toEqual([]);
    expect(asObject(o.e)).toEqual({});
  });

  it("rejects malformed JSON rather than guessing", () => {
    for (const bad of ["", "{", "{'a':1}", "[1,]", '{"a":01}', '{"a":1}extra', '{"a":+1}', '{"a":.5}']) {
      expect(() => parseJsonPreservingNumbers(bad), bad).toThrow();
    }
  });

  it("safeInteger refuses fractions, exponents and unsafe magnitudes", () => {
    const o = asObject(parseJsonPreservingNumbers('{"a":1.5,"b":1e3,"c":9007199254740993,"d":42}'))!;
    expect(safeInteger(o.a)).toBeNull();
    expect(safeInteger(o.b)).toBeNull();
    expect(safeInteger(o.c)).toBeNull();
    expect(safeInteger(o.d)).toBe(42);
  });

  it("accessors return null for the wrong shape instead of throwing", () => {
    const v = parseJsonPreservingNumbers('{"a":1}');
    expect(asArray(v)).toBeNull();
    expect(asString(v)).toBeNull();
    expect(rawNumber(v)).toBeNull();
    expect(asObject(new RawNumber("1"))).toBeNull();
  });

  it("property: every parsed number lexeme survives untouched and stays a valid decimal", () => {
    const money = fc.tuple(fc.nat(999999), fc.nat(99)).map(([w, c]) => `${w}.${String(c).padStart(2, "0")}`);
    fc.assert(
      fc.property(money, (lexeme) => {
        const parsed = rawNumber(asObject(parseJsonPreservingNumbers(`{"close":${lexeme}}`))!.close);
        expect(parsed).toBe(lexeme);
        expect(plainDecimal(parsed!)).not.toBeNull();
      }),
    );
  });

  it("property: agrees with JSON.parse on structure for ordinary payloads", () => {
    fc.assert(
      fc.property(fc.json(), (text) => {
        const strip = (v: unknown): unknown =>
          v instanceof RawNumber
            ? Number(v.raw)
            : Array.isArray(v)
              ? v.map(strip)
              : v && typeof v === "object"
                ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, strip(x)]))
                : v;
        expect(strip(parseJsonPreservingNumbers(text))).toEqual(JSON.parse(text));
      }),
    );
  });
});

describe("prototype-polluting keys", () => {
  it("treats __proto__ as data, exactly as JSON.parse does", () => {
    const text = '{"__proto__":{"polluted":1},"close":1.5}';
    const mine = parseJsonPreservingNumbers(text);
    expect(Object.prototype.hasOwnProperty.call(mine as object, "__proto__")).toBe(true);
    expect(Object.keys(mine as object)).toEqual(Object.keys(JSON.parse(text)));
    expect(rawNumber(asObject(mine)!.close)).toBe("1.5");
  });

  it("cannot fabricate a price through the prototype chain", () => {
    // Regression: plain assignment let this object report close = 999999
    // despite having no own `close` key — an upstream payload inventing a
    // price. JSON.parse yields undefined here, and so must this.
    const o = asObject(parseJsonPreservingNumbers('{"__proto__":{"close":999999}}'))!;
    expect(rawNumber(o.close)).toBeNull();
    expect((JSON.parse('{"__proto__":{"close":999999}}') as Record<string, unknown>).close).toBeUndefined();
  });

  it("does not leak into other objects", () => {
    parseJsonPreservingNumbers('{"__proto__":{"leaked":true}}');
    expect(({} as Record<string, unknown>).leaked).toBeUndefined();
  });

  it("keeps 'constructor' and 'toString' as ordinary data keys", () => {
    const o = asObject(parseJsonPreservingNumbers('{"constructor":5,"toString":"x"}'))!;
    expect(rawNumber(o.constructor as never)).toBe("5");
    expect(asString(o.toString as never)).toBe("x");
  });
});
