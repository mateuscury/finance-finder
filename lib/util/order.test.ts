import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { byString, nullsFirst } from "./order";

type Row = { id: string; at: string | null };
const cmp = nullsFirst<Row>(
  (r) => r.at,
  byString((r) => r.id),
);

describe("nullsFirst", () => {
  it("puts nulls first, then the key ascending, then the tiebreak", () => {
    const rows: Row[] = [
      { id: "c", at: "2026-01-02" },
      { id: "b", at: null },
      { id: "a", at: "2026-01-01" },
      { id: "d", at: "2026-01-01" },
      { id: "e", at: null },
    ];
    expect([...rows].sort(cmp).map((r) => r.id)).toEqual(["b", "e", "a", "d", "c"]);
  });

  it("is a total order: antisymmetric and consistent with the tiebreak on equal keys", () => {
    const row = fc.record({
      id: fc.string({ minLength: 1, maxLength: 3 }),
      at: fc.option(fc.constantFrom("a", "b", "c"), { nil: null }),
    });
    fc.assert(
      fc.property(row, row, (x, y) => {
        const xy = Math.sign(cmp(x, y));
        const yx = Math.sign(cmp(y, x));
        expect(xy).toBe(-yx);
        if (xy === 0) expect(x.id).toBe(y.id);
      }),
    );
  });
});
