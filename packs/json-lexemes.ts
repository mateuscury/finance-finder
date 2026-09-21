/**
 * packs/json-lexemes.ts — KERNEL-OWNED, like types.ts, schema.ts, coverage.ts.
 *
 * A JSON reader that preserves NUMBER LEXEMES as text.
 *
 * Why this exists: `JSON.parse` turns `{"close":185147.16}` into an IEEE
 * double, and stringifying it back is a round trip through binary floating
 * point — the exact digits the venue published are no longer guaranteed. The
 * pack boundary requires decimal strings precisely to avoid that
 * (CLAUDE.md non-negotiables, PACKS.md §7 rule 2), so an adapter reading a JSON
 * API must never `JSON.parse` a monetary number and convert it back.
 *
 * The alternative the plan rejects — running a regular expression over the
 * whole body — cannot tell `"close"` inside a string literal from a real key,
 * and silently matches the wrong field. This is a real (small) parser instead:
 * it tracks structure, so a lexeme is only returned for the key that owns it.
 */

/** A JSON number kept exactly as it was written in the payload. */
export class RawNumber {
  constructor(readonly raw: string) {}
}

export type JsonValue = string | boolean | null | RawNumber | JsonValue[] | { [key: string]: JsonValue };

const WHITESPACE = new Set([" ", "\t", "\n", "\r"]);
const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" };

class JsonReader {
  private i = 0;
  constructor(private readonly s: string) {}

  parse(): JsonValue {
    const value = this.value();
    this.skipWhitespace();
    if (this.i !== this.s.length) throw new SyntaxError("trailing content after JSON value");
    return value;
  }

  private skipWhitespace(): void {
    while (this.i < this.s.length && WHITESPACE.has(this.s[this.i])) this.i++;
  }

  private expect(c: string): void {
    if (this.s[this.i] !== c) throw new SyntaxError(`expected '${c}' at ${this.i}`);
    this.i++;
  }

  private value(): JsonValue {
    this.skipWhitespace();
    const c = this.s[this.i];
    if (c === undefined) throw new SyntaxError("unexpected end of JSON");
    if (c === "{") return this.object();
    if (c === "[") return this.array();
    if (c === '"') return this.string();
    if (this.s.startsWith("true", this.i)) return ((this.i += 4), true);
    if (this.s.startsWith("false", this.i)) return ((this.i += 5), false);
    if (this.s.startsWith("null", this.i)) return ((this.i += 4), null);
    return this.number();
  }

  private object(): { [key: string]: JsonValue } {
    this.expect("{");
    const out: { [key: string]: JsonValue } = {};
    this.skipWhitespace();
    if (this.s[this.i] === "}") return (this.i++, out);
    for (;;) {
      this.skipWhitespace();
      const key = this.string();
      this.skipWhitespace();
      this.expect(":");
      const value = this.value();
      // `out[key] = value` would be wrong for the key "__proto__": plain
      // assignment REPLACES the object's prototype instead of creating an own
      // property. The key then vanishes from Object.keys, and — far worse — a
      // payload like {"__proto__":{"close":999999}} would make `o.close` read
      // back 999999 from an object that has no close at all, fabricating a
      // price out of an upstream response. `JSON.parse` creates a genuine own
      // property here, and defineProperty is how that behaviour is matched.
      Object.defineProperty(out, key, { value, writable: true, enumerable: true, configurable: true });
      this.skipWhitespace();
      if (this.s[this.i] === ",") {
        this.i++;
        continue;
      }
      this.expect("}");
      return out;
    }
  }

  private array(): JsonValue[] {
    this.expect("[");
    const out: JsonValue[] = [];
    this.skipWhitespace();
    if (this.s[this.i] === "]") return (this.i++, out);
    for (;;) {
      out.push(this.value());
      this.skipWhitespace();
      if (this.s[this.i] === ",") {
        this.i++;
        continue;
      }
      this.expect("]");
      return out;
    }
  }

  private string(): string {
    this.expect('"');
    let out = "";
    for (;;) {
      const c = this.s[this.i];
      if (c === undefined) throw new SyntaxError("unterminated string");
      this.i++;
      if (c === '"') return out;
      if (c !== "\\") {
        out += c;
        continue;
      }
      const esc = this.s[this.i++];
      if (esc === "u") {
        out += String.fromCharCode(parseInt(this.s.slice(this.i, this.i + 4), 16));
        this.i += 4;
      } else if (esc in ESCAPES) out += ESCAPES[esc];
      else throw new SyntaxError(`bad escape '\\${esc}'`);
    }
  }

  private number(): RawNumber {
    const re = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
    re.lastIndex = this.i;
    const m = re.exec(this.s);
    if (!m || m.index !== this.i) throw new SyntaxError(`invalid JSON value at ${this.i}`);
    this.i += m[0].length;
    // The lexeme is kept verbatim. Nothing here calls Number().
    return new RawNumber(m[0]);
  }
}

/**
 * Parse JSON text, representing every number as a `RawNumber` holding its
 * original digits. Throws `SyntaxError` on malformed input, like `JSON.parse`.
 */
export function parseJsonPreservingNumbers(text: string): JsonValue {
  return new JsonReader(text).parse();
}

// --- small typed accessors, so adapters do not hand-roll shape checks --------

export function asObject(v: JsonValue | undefined): { [key: string]: JsonValue } | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof RawNumber) ? v : null;
}

export function asArray(v: JsonValue | undefined): JsonValue[] | null {
  return Array.isArray(v) ? v : null;
}

export function asString(v: JsonValue | undefined): string | null {
  return typeof v === "string" ? v : null;
}

/** The verbatim lexeme of a JSON number, or null if the value is not a number. */
export function rawNumber(v: JsonValue | undefined): string | null {
  return v instanceof RawNumber ? v.raw : null;
}

/**
 * A JSON number that is safe to read as a JS integer — a Unix timestamp or a
 * count, never money. Rejects fractions, exponents and anything beyond the
 * exact-integer range.
 */
export function safeInteger(v: JsonValue | undefined): number | null {
  const raw = rawNumber(v);
  if (raw === null || !/^-?\d+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) ? n : null;
}
