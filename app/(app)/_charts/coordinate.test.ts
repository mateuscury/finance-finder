import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { toCoordinate } from "./coordinate";

const ROOT = path.resolve(__dirname, "../../..");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".next" || entry.name === "testing") continue;
      sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|dbtest)\.ts$/.test(entry.name) && entry.name !== "database.types.ts") {
      out.push(full);
    }
  }
  return out;
}

describe("toCoordinate", () => {
  it("turns a decimal string into a number for a chart axis", () => {
    expect(toCoordinate("1.5")).toBe(1.5);
    expect(toCoordinate("-0.25")).toBe(-0.25);
  });

  it("is the only Number() call on a value in app/ and lib/ source", () => {
    const offenders = [...sourceFiles(path.join(ROOT, "app")), ...sourceFiles(path.join(ROOT, "lib"))]
      .filter((f) => /(^|[^.\w])Number\s*\(|parseFloat\s*\(/.test(fs.readFileSync(f, "utf8")))
      .map((f) => path.relative(ROOT, f));
    expect(offenders).toEqual(["app/(app)/_charts/coordinate.ts"]);
  });
});
