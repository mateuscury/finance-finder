/**
 * PACKS.md §11.1 Manifest validity, §11.2 Referential integrity,
 * §5 curve_mark_to_market metadata constraint.
 */
import { describe, expect, it } from "vitest";
import { PACKS } from "..";
import { CURVE_METADATA_SAMPLE, CurveMetadataBaseSchema, MarketPackSchema } from "../schema";
import { PACK_API_VERSION, type MarketPack } from "../types";

const packIds = PACKS.map((p) => p.id);

describe.each(PACKS.map((p) => [p.id, p] as const))("pack '%s' — manifest validity", (_, pack) => {
  it("parses against the kernel schema", () => {
    const r = MarketPackSchema.safeParse(pack);
    expect(r.success, r.success ? "" : JSON.stringify(r.error.issues, null, 2)).toBe(true);
  });

  it(`declares apiVersion ${PACK_API_VERSION}`, () => {
    expect(pack.apiVersion).toBe(PACK_API_VERSION);
  });

  it("prefixes every instrument, series and source id with its own id", () => {
    const ids = [
      ...pack.instruments.map((i) => i.id),
      ...pack.series.map((s) => s.id),
      ...pack.sources.map((s) => s.id),
    ];
    for (const id of ids) {
      expect(id, `'${id}' must start with '${pack.id}.'`).toMatch(new RegExp(`^${pack.id}\\.`));
    }
  });

  it("has no duplicate ids within the pack", () => {
    const ids = [
      ...pack.instruments.map((i) => i.id),
      ...pack.series.map((s) => s.id),
      ...pack.sources.map((s) => s.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only depends on packs that exist", () => {
    for (const dep of pack.dependencies ?? []) {
      expect(packIds, `dependency '${dep}' is not registered`).toContain(dep);
      expect(dep).not.toBe(pack.id);
    }
  });
});

describe("registry", () => {
  it("has unique pack ids", () => {
    expect(new Set(packIds).size).toBe(packIds.length);
  });

  it("has no id collisions across packs", () => {
    const seen = new Map<string, string>();
    for (const p of PACKS) {
      for (const id of [...p.instruments, ...p.series, ...p.sources].map((x) => x.id)) {
        expect(seen.has(id), `'${id}' declared by both '${seen.get(id)}' and '${p.id}'`).toBe(false);
        seen.set(id, p.id);
      }
    }
  });

  it("has no dependency cycles", () => {
    const visit = (pack: MarketPack, path: string[]) => {
      expect(path, `pack dependency cycle: ${[...path, pack.id].join(" -> ")}`).not.toContain(pack.id);
      for (const dependencyId of pack.dependencies ?? []) {
        const dependency = PACKS.find((candidate) => candidate.id === dependencyId);
        if (dependency) visit(dependency, [...path, pack.id]);
      }
    };
    for (const pack of PACKS) visit(pack, []);
  });
});

function resolvable(pack: MarketPack) {
  const scope = scopePacks(pack);
  const series = new Set(scope.flatMap((p) => p.series.map((s) => s.id)));
  const sources = new Set(scope.flatMap((p) => p.sources.map((s) => s.id)));
  return { series, sources };
}

function scopePacks(pack: MarketPack): MarketPack[] {
  const found = new Map<string, MarketPack>();
  const visit = (candidate: MarketPack) => {
    if (found.has(candidate.id)) return;
    found.set(candidate.id, candidate);
    for (const dependencyId of candidate.dependencies ?? []) {
      const dependency = PACKS.find((p) => p.id === dependencyId);
      if (dependency) visit(dependency);
    }
  };
  visit(pack);
  return [...found.values()];
}

describe.each(PACKS.map((p) => [p.id, p] as const))("pack '%s' — referential integrity", (_, pack) => {
  const { series, sources } = resolvable(pack);

  it("every series.sourceId resolves", () => {
    for (const s of pack.series) {
      expect(sources, `${s.id} → source '${s.sourceId}'`).toContain(s.sourceId);
    }
  });

  it("every instrument valuation reference resolves", () => {
    for (const i of pack.instruments) {
      const v = i.valuation;
      if (v.kind === "market_price" || v.kind === "nav_unit_price") {
        expect(sources, `${i.id} → source '${v.sourceId}'`).toContain(v.sourceId);
      } else if (v.kind === "curve_mark_to_market") {
        expect(series, `${i.id} → series '${v.seriesId}'`).toContain(v.seriesId);
        const s = [...scopeSeries(pack)].find((x) => x.id === v.seriesId);
        expect(s?.kind.kind, `${i.id} discounts off '${v.seriesId}', which must be a yield_curve`).toBe(
          "yield_curve",
        );
      } else if (v.kind === "accrual" && v.convention.index) {
        expect(series, `${i.id} → accrual index '${v.convention.index.seriesId}'`).toContain(
          v.convention.index.seriesId,
        );
      }
    }
  });

  it("every source a series or instrument uses declares a matching capability", () => {
    const allSources = new Map(
      PACKS.flatMap((p) => p.sources).map((s) => [s.id, s] as const),
    );
    for (const s of pack.series) {
      const src = allSources.get(s.sourceId);
      const needed = s.kind.kind === "fx_rate" ? "fx" : "series";
      expect(src?.capabilities, `${s.sourceId} must offer '${needed}' for ${s.id}`).toContain(needed);
    }
    for (const i of pack.instruments) {
      if (i.valuation.kind === "market_price" || i.valuation.kind === "nav_unit_price") {
        const src = allSources.get(i.valuation.sourceId);
        expect(src?.capabilities, `${i.valuation.sourceId} must offer 'spot' for ${i.id}`).toContain("spot");
      }
    }
  });
});

function scopeSeries(pack: MarketPack) {
  return scopePacks(pack).flatMap((p) => p.series);
}

describe("curve_mark_to_market metadata constraint (PACKS.md §5)", () => {
  const curveKinds = PACKS.flatMap((p) =>
    p.instruments.filter((i) => i.valuation.kind === "curve_mark_to_market").map((k) => [k.id, k] as const),
  );

  // Deliberately NOT skipped when no pack currently uses the strategy. Since
  // `br.tesouro_direto` moved to `nav_unit_price` (MILESTONES.md decision 2)
  // there are no curve instruments in-repo, but the kernel constraint still
  // governs the next pack that adds one, so it is asserted directly. Skipping
  // here would let the shared shape rot unnoticed until Milestone 4.
  it("the kernel curve metadata shape accepts its canonical sample and rejects an empty object", () => {
    expect(CurveMetadataBaseSchema.safeParse(CURVE_METADATA_SAMPLE).success).toBe(true);
    expect(CurveMetadataBaseSchema.safeParse({}).success).toBe(false);
    expect(
      CurveMetadataBaseSchema.safeParse({ ...CURVE_METADATA_SAMPLE, maturity: undefined }).success,
      "a curve instrument without a maturity cannot be discounted",
    ).toBe(false);
  });

  it("every in-repo curve instrument accepts the kernel shape and rejects an empty object", () => {
    for (const [id, kind] of curveKinds) {
      // Packs may add required fields on top; fill the common ones permissively.
      const sample = { ...CURVE_METADATA_SAMPLE, titulo: "x", name: "x" };
      const r = kind.metadataSchema.safeParse(sample);
      expect(
        r.success,
        `${id}: curve_mark_to_market instruments must accept {maturity, coupon, indexation} ` +
          `(PACKS.md §5). Issues: ${r.success ? "" : JSON.stringify(r.error.issues)}`,
      ).toBe(true);
      expect(kind.metadataSchema.safeParse({}).success, `${id} accepted {}`).toBe(false);
      expect(kind.metadataSchema.safeParse({ ...sample, maturity: undefined }).success, `${id} accepted a missing maturity`).toBe(false);
    }
  });
});
