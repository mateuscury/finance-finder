import { describe, expect, it } from "vitest";
import { resolveColumns } from "@/lib/import";
import { tradeDateBound } from "./load";

const HEADER = [
  "date",
  "type",
  "pack",
  "instrument_kind",
  "identifier",
  "quantity",
  "unit_price",
  "currency",
  "fees",
  "note",
];
const row = (date: string) => [date, "buy", "br", "br.fii", "HGLG11", "1", "1", "BRL", "0", ""];

describe("tradeDateBound (Milestone 4 D-14)", () => {
  it("is the [min, max] of the parsable dates, ignoring rows whose date does not parse", () => {
    const mapping = resolveColumns(HEADER);
    expect(
      tradeDateBound([row("2026-03-02"), row("not-a-date"), row("2025-12-31"), row("2026-01-15")], mapping),
    ).toEqual({
      min: "2025-12-31",
      max: "2026-03-02",
    });
  });

  it("is null for an empty file, when no date parses, or when the date column is missing", () => {
    const mapping = resolveColumns(HEADER);
    expect(tradeDateBound([], mapping)).toBeNull();
    expect(tradeDateBound([row("")], mapping)).toBeNull();
    expect(tradeDateBound([row("2026-01-01")], resolveColumns(HEADER.filter((h) => h !== "date")))).toBeNull();
  });
});
