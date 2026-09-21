import { describe, expect, it } from "vitest";
import { copyFor, isSupportedLocale, LOCALES } from "./index";
import { en } from "./en";
import { ptBR } from "./pt-BR";

/** Every leaf path of a dictionary, functions included, in stable order. */
function leaves(value: unknown, prefix = ""): Array<[string, unknown]> {
  if (typeof value === "string" || typeof value === "function") return [[prefix, value]];
  if (value && typeof value === "object") {
    return Object.keys(value as object)
      .sort()
      .flatMap((k) => leaves((value as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k));
  }
  return [[prefix, value]];
}

describe("copy dictionaries (decision 34)", () => {
  it("have identical key sets", () => {
    expect(leaves(ptBR).map(([k]) => k)).toEqual(leaves(en).map(([k]) => k));
  });

  it("have no empty leaf and no leaf that is not a string or a function", () => {
    for (const dict of [en, ptBR]) {
      for (const [path, leaf] of leaves(dict)) {
        expect(typeof leaf === "string" || typeof leaf === "function", `${path} is ${typeof leaf}`).toBe(true);
        if (typeof leaf === "string") expect(leaf.trim(), path).not.toBe("");
      }
    }
  });

  it("interpolating functions produce non-empty, different text per language", () => {
    const a = en.restore.warnings({ count: 2, codes: "unknown_pack" });
    const b = ptBR.restore.warnings({ count: 2, codes: "unknown_pack" });
    expect(a).toContain("2");
    expect(b).toContain("2");
    expect(a).not.toBe(b);
    expect(en.checkFields({ fields: "quantity, date" })).toBe(" Check: quantity, date.");
    expect(ptBR.checkFields({ fields: "quantity, date" })).toBe(" Verifique: quantity, date.");
  });

  it("every interpolating leaf renders non-empty text for singular, plural, present and absent parameters", () => {
    const samples: Array<Record<string, unknown>> = [
      {
        n: 1,
        count: 1,
        codes: "unknown_pack",
        date: "2026-02-27",
        reason: "429",
        fields: "quantity",
        currency: "BRL",
        from: "2026-01-01",
        to: "2026-02-01",
        through: "2026-01-15",
        target: "2026-02-01",
        sourceId: "br.brapi",
        variable: "BRAPI_TOKEN",
        lastExportAt: "2026-01-01T00:00:00Z",
      },
      {
        n: 3,
        count: 3,
        codes: "unknown_pack,invalid_metadata",
        date: "2026-02-27",
        reason: "missing_env:BRAPI_TOKEN",
        fields: "quantity, date",
        currency: "USD",
        from: "2026-01-01",
        to: "2026-02-01",
        through: null,
        target: "2026-02-01",
        sourceId: "br.brapi",
        variable: "BRAPI_TOKEN",
        lastExportAt: null,
      },
    ];
    for (const dict of [en, ptBR]) {
      for (const [path, leaf] of leaves(dict)) {
        if (typeof leaf !== "function") continue;
        for (const params of samples) {
          const text = (leaf as (p: Record<string, unknown>) => string)(params);
          expect(typeof text, path).toBe("string");
          expect(text.trim(), path).not.toBe("");
        }
      }
    }
    // Singular and plural differ where a count is interpolated.
    expect(en.strip.unpriced({ n: 1 })).not.toBe(en.strip.unpriced({ n: 2 }));
    expect(ptBR.empty.overviewHeadline({ n: 1 })).not.toBe(ptBR.empty.overviewHeadline({ n: 2 }));
  });

  it("copyFor matches a shipped locale exactly and falls back to English", () => {
    expect(copyFor("pt-BR")).toBe(ptBR);
    expect(copyFor("en")).toBe(en);
    expect(copyFor("pt-br")).toBe(en);
    expect(copyFor("fr")).toBe(en);
    expect(LOCALES.every(isSupportedLocale)).toBe(true);
  });
});
