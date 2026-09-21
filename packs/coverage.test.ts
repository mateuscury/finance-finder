import { describe, expect, it } from "vitest";
import { RefCoverageSchema } from "./schema";
import { coverageFor } from "./coverage";
import type { FetchPoint } from "./types";

const p = (ref: string, date: string): FetchPoint => ({ ref, date, value: "1", currency: null });

describe("coverageFor", () => {
  it("spans only the points belonging to each ref", () => {
    const points = [p("a", "2026-01-05"), p("b", "2026-01-09"), p("a", "2026-01-02")];
    const cov = coverageFor(["a", "b"], { from: "2026-01-01", to: "2026-01-31" }, points, () => true);
    expect(cov).toEqual([
      {
        ref: "a",
        requested: { from: "2026-01-01", to: "2026-01-31" },
        returned: { from: "2026-01-02", to: "2026-01-05" },
        complete: true,
      },
      {
        ref: "b",
        requested: { from: "2026-01-01", to: "2026-01-31" },
        returned: { from: "2026-01-09", to: "2026-01-09" },
        complete: true,
      },
    ]);
  });

  it("returns a null span for a ref with no points and keeps the adapter's completeness verdict", () => {
    const cov = coverageFor(["a", "b"], { from: "2026-01-01", to: "2026-01-31" }, [], (ref) => ref === "a");
    expect(cov[0]).toMatchObject({ returned: null, complete: true });
    expect(cov[1]).toMatchObject({ returned: null, complete: false });
  });

  it("emits exactly one entry per requested ref, in request order", () => {
    expect(
      coverageFor(["z", "y", "x"], { from: "2026-01-01", to: "2026-01-02" }, [], () => true).map((c) => c.ref),
    ).toEqual(["z", "y", "x"]);
  });

  it("produces entries that satisfy the kernel coverage schema", () => {
    const cov = coverageFor(["a"], { from: "2026-01-01", to: "2026-01-31" }, [p("a", "2026-01-05")], () => false);
    expect(RefCoverageSchema.safeParse(cov[0]).success).toBe(true);
  });
});
