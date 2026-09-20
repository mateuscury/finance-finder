import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseCsv } from "./parse";
import { writeCsv } from "./write";

describe("parseCsv", () => {
  it("reads the canonical example with LF, CRLF and a BOM alike", () => {
    const body = "date,type,pack,instrument_kind,identifier,quantity,unit_price,currency,fees,note\n2024-03-14,buy,br,br.fii,HGLG11,100,162.40,BRL,2.50,\n2024-06-28,dividend,br,br.fii,HGLG11,0,132.00,BRL,0,June distribution\n";
    for (const text of [body, body.replace(/\n/g, "\r\n"), `﻿${body}`]) {
      const r = parseCsv(text);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.header).toEqual(["date", "type", "pack", "instrument_kind", "identifier", "quantity", "unit_price", "currency", "fees", "note"]);
      expect(r.rows).toEqual([
        ["2024-03-14", "buy", "br", "br.fii", "HGLG11", "100", "162.40", "BRL", "2.50", ""],
        ["2024-06-28", "dividend", "br", "br.fii", "HGLG11", "0", "132.00", "BRL", "0", "June distribution"],
      ]);
    }
  });

  it("handles quoted fields, doubled quotes, embedded newlines, empty fields and a missing final newline", () => {
    const r = parseCsv('a,b,c\n"x, y","say ""hi""","line1\nline2"\n,,\nlast,,row');
    expect(r).toEqual({
      ok: true,
      header: ["a", "b", "c"],
      rows: [
        ["x, y", 'say "hi"', "line1\nline2"],
        ["", "", ""],
        ["last", "", "row"],
      ],
    });
  });

  it("rejects an unterminated quote, a quote inside an unquoted field, and an empty file, naming the line", () => {
    expect(parseCsv('a,b\n"open,1\n')).toEqual({ ok: false, reason: "unterminated_quote", line: 3 });
    expect(parseCsv('a,b\nx"y,1\n')).toEqual({ ok: false, reason: "quote_in_unquoted_field", line: 2 });
    expect(parseCsv("")).toEqual({ ok: false, reason: "empty", line: 1 });
    expect(parseCsv("\n\n")).toEqual({ ok: false, reason: "empty", line: 1 });
  });

  it("does not trim or coerce: a quantity stays the text it was", () => {
    const r = parseCsv("q\n 100.50 \n");
    expect(r.ok && r.rows[0][0]).toBe(" 100.50 ");
  });
});

describe("writeCsv ∘ parseCsv", () => {
  const field = fc.string({ maxLength: 12 }).filter((s) => !s.includes("﻿"));
  const width = fc.integer({ min: 1, max: 6 });

  it("property: parse(write(header, rows)) = { header, rows } for any text including quotes, commas and newlines", () => {
    fc.assert(
      fc.property(width, fc.integer({ min: 1, max: 8 }), fc.infiniteStream(field), (w, n, stream) => {
        const take = () => Array.from({ length: w }, () => stream.next().value as string);
        const header = take();
        const rows = Array.from({ length: n }, take);
        // A row of empty strings with width 1 is indistinguishable from a blank line by design.
        if (w === 1 && rows.some((r) => r[0] === "")) return;
        if (w === 1 && header[0] === "") return;
        const r = parseCsv(writeCsv(header, rows));
        expect(r).toEqual({ ok: true, header, rows });
      }),
    );
  });
});
