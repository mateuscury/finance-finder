import { describe, expect, it } from "vitest";
import { PAGE_SIZE, readAll } from "./paginate";

describe("readAll", () => {
  it("keeps requesting pages until one comes back short, with inclusive ranges", async () => {
    const rows = Array.from({ length: PAGE_SIZE * 2 + 3 }, (_, i) => i);
    const ranges: Array<[number, number]> = [];
    const out = await readAll<number>((from, to) => {
      ranges.push([from, to]);
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    });
    expect(out).toEqual(rows);
    expect(ranges).toEqual([
      [0, PAGE_SIZE - 1],
      [PAGE_SIZE, 2 * PAGE_SIZE - 1],
      [2 * PAGE_SIZE, 3 * PAGE_SIZE - 1],
    ]);
  });

  it("returns an empty list on an empty first page and throws the PostgREST message on error", async () => {
    expect(await readAll<number>(() => Promise.resolve({ data: [], error: null }))).toEqual([]);
    expect(await readAll<number>(() => Promise.resolve({ data: null, error: null }))).toEqual([]);
    await expect(readAll<number>(() => Promise.resolve({ data: null, error: { message: "boom" } }))).rejects.toThrow(
      /paginate: boom/,
    );
  });

  it("stops exactly at a page boundary when the last page is full and the next is empty", async () => {
    const rows = Array.from({ length: 4 }, (_, i) => i);
    let calls = 0;
    const out = await readAll<number>((from, to) => {
      calls += 1;
      return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
    }, 2);
    expect(out).toEqual(rows);
    expect(calls).toBe(3);
  });
});
