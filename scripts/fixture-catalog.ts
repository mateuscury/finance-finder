/**
 * The checked-in catalog of PUBLIC sample identifiers used to record fixtures
 * (plan §2.2: "Fixture inputs are a checked-in catalog of public sample
 * identifiers, never read from a user's database").
 *
 * Every declared capability of every source must appear in both a `success`
 * and an `empty` case, which `packs/conformance/fixtures.test.ts` enforces.
 * The windows are fixed dates, not relative to today, so a re-recording is a
 * deliberate act rather than something that drifts.
 */
import type { FetchRequest } from "@/packs/types";

export interface CatalogCase {
  /** Why this case exists, for the person reading the fixture later. */
  note: string;
  input: FetchRequest;
}

export interface SourceCatalog {
  sourceId: string;
  success: CatalogCase[];
  empty: CatalogCase[];
  /** One representative input; error fixtures need only exercise one path. */
  errorInput: FetchRequest;
  /**
   * Optional body reducer for bulk downloads. Tesouro publishes ONE ~14 MB CSV
   * containing every bond since 2004; recording it verbatim would add tens of
   * megabytes to the repository per case. The reduced body keeps the header and
   * the rows the catalog refs actually need, so the exact delimiter, decimal
   * notation and column layout the adapter parses are preserved byte for byte.
   */
  trimBody?: (body: string) => string;
}

/** Keep the CSV header plus rows mentioning any of these bond descriptors. */
function trimTesouroCsv(body: string): string {
  const lines = body.split(/\r?\n/);
  const header = lines[0];
  const wanted = [
    ["Tesouro Selic", "01/03/2029"],
    ["Tesouro IPCA+ com Juros Semestrais", "15/05/2035"],
  ];
  const kept = lines
    .slice(1)
    .filter((line) => wanted.some(([tipo, venc]) => line.startsWith(`${tipo};${venc};`)))
    // Newest rows first in the source file; a few months is ample for replay.
    .slice(0, 120);
  return [header, ...kept, ""].join("\n");
}

export const FIXTURE_CATALOG: SourceCatalog[] = [
  {
    sourceId: "global.bcb_ptax",
    success: [
      {
        note: "fx: four consecutive business days",
        input: { capability: "fx", refs: ["global.usdbrl"], from: "2026-09-01", to: "2026-09-04" },
      },
      {
        note: "historical: same window, same contract",
        input: { capability: "historical", refs: ["global.usdbrl"], from: "2026-09-01", to: "2026-09-04" },
      },
    ],
    empty: [
      {
        note: "fx: a weekend has no fixing (200, header-only body)",
        input: { capability: "fx", refs: ["global.usdbrl"], from: "2026-09-05", to: "2026-09-06" },
      },
      {
        note: "historical: before PTAX's history begins",
        input: { capability: "historical", refs: ["global.usdbrl"], from: "1980-01-01", to: "1980-01-10" },
      },
    ],
    errorInput: { capability: "fx", refs: ["global.usdbrl"], from: "2026-09-01", to: "2026-09-04" },
  },
  {
    sourceId: "br.bcb_sgs",
    success: [
      {
        note: "series: CDI and SELIC over published business days",
        input: { capability: "series", refs: ["br.cdi", "br.selic"], from: "2026-09-01", to: "2026-09-03" },
      },
    ],
    empty: [
      {
        note: "series: a weekend, which SGS answers with 404 'Value(s) not found'",
        input: { capability: "series", refs: ["br.cdi"], from: "2026-09-05", to: "2026-09-06" },
      },
    ],
    errorInput: { capability: "series", refs: ["br.cdi"], from: "2026-09-01", to: "2026-09-03" },
  },
  {
    sourceId: "br.ibge_sidra",
    success: [
      {
        note: "series: seven months of published IPCA index levels",
        input: { capability: "series", refs: ["br.ipca"], from: "2026-01-01", to: "2026-07-31" },
      },
    ],
    empty: [
      {
        note: "series: months far in the future are published as []",
        input: { capability: "series", refs: ["br.ipca"], from: "2090-01-01", to: "2090-03-31" },
      },
    ],
    errorInput: { capability: "series", refs: ["br.ipca"], from: "2026-01-01", to: "2026-07-31" },
  },
  {
    sourceId: "br.brapi",
    success: [
      { note: "spot: a liquid, non-sandbox FII", input: { capability: "spot", refs: ["HGLG11"] } },
      {
        note: "historical: the same FII over a recent window inside the free plan's 3mo cap",
        input: { capability: "historical", refs: ["HGLG11"], from: "2026-09-01", to: "2026-09-04" },
      },
      {
        note: "spot: an equity ticker — the br.stock kind (MILESTONES §4 decision 33)",
        input: { capability: "spot", refs: ["PETR4"] },
      },
      {
        note: "historical: the same equity over the same window",
        input: { capability: "historical", refs: ["PETR4"], from: "2026-09-01", to: "2026-09-04" },
      },
      {
        note: "series: both index symbols, ^BVSP and IFIX.SA",
        input: { capability: "series", refs: ["br.ibovespa", "br.ifix"], from: "2026-09-01", to: "2026-09-04" },
      },
    ],
    empty: [
      {
        note: "spot: an unlisted symbol, which brapi answers with 404 NOT_FOUND",
        input: { capability: "spot", refs: ["ZZZZ99"] },
      },
      // A PAST weekend, not the current one: brapi emits a bar for today even
      // on a non-trading day, so "this weekend" is not actually empty.
      {
        note: "historical: a past weekend window filters every returned bar away",
        input: { capability: "historical", refs: ["HGLG11"], from: "2026-08-29", to: "2026-08-30" },
      },
      {
        note: "series: the same past weekend window for both indices",
        input: { capability: "series", refs: ["br.ibovespa", "br.ifix"], from: "2026-08-29", to: "2026-08-30" },
      },
    ],
    errorInput: { capability: "historical", refs: ["HGLG11"], from: "2026-09-01", to: "2026-09-04" },
  },
  {
    sourceId: "br.tesouro_transparente",
    success: [
      {
        note: "spot: newest published PU for two real bonds",
        input: {
          capability: "spot",
          refs: ["td:tesouro-selic:2029-03-01", "td:tesouro-ipca-com-juros-semestrais:2035-05-15"],
        },
      },
      {
        note: "historical: the same bonds over a recent window",
        input: {
          capability: "historical",
          refs: ["td:tesouro-selic:2029-03-01", "td:tesouro-ipca-com-juros-semestrais:2035-05-15"],
          from: "2026-09-01",
          to: "2026-09-04",
        },
      },
    ],
    empty: [
      {
        note: "spot: a bond that has never been issued",
        input: { capability: "spot", refs: ["td:tesouro-selic:2099-01-01"] },
      },
      {
        note: "historical: a real bond over a window before it existed",
        input: {
          capability: "historical",
          refs: ["td:tesouro-selic:2029-03-01"],
          from: "2005-01-03",
          to: "2005-01-07",
        },
      },
    ],
    errorInput: {
      capability: "historical",
      refs: ["td:tesouro-selic:2029-03-01"],
      from: "2026-09-01",
      to: "2026-09-04",
    },
    trimBody: trimTesouroCsv,
  },
];

export function catalogFor(sourceId: string): SourceCatalog | undefined {
  return FIXTURE_CATALOG.find((c) => c.sourceId === sourceId);
}
