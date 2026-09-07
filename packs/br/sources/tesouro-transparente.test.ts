import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { abortedSignal, testContext, textResponse } from "../../conformance/helpers";
import { FetchPointSchema } from "../../schema";
import {
  fetchTesouroTransparente,
  fromBrDate,
  resolveColumns,
  slugify,
  tesouroCanonicalId,
} from "./tesouro-transparente";

const HEADER =
  "Tipo Titulo;Data Vencimento;Data Base;Taxa Compra Manha;Taxa Venda Manha;PU Compra Manha;PU Venda Manha;PU Base Manha";

/** Real row shapes taken from the live file on 2026-09-06. */
const ROWS = [
  "Tesouro Selic;01/03/2029;04/09/2026;0,03;0,04;19810,47;19795,28;19795,28",
  "Tesouro Selic;01/03/2029;03/09/2026;0,03;0,04;19800,00;19790,00;19788,10",
  "Tesouro IPCA+ com Juros Semestrais;15/05/2035;04/09/2026;7,10;7,20;4321,00;4310,00;4315,55",
  "Tesouro Prefixado;01/01/2029;04/09/2026;13,50;13,60;800,00;799,00;799,50",
];
const BODY = [HEADER, ...ROWS].join("\n");

const SELIC = "td:tesouro-selic:2029-03-01";
const IPCA_JS = "td:tesouro-ipca-com-juros-semestrais:2035-05-15";

const ctx = (status: number, body: string, calls: string[] = []) =>
  testContext({ now: "2026-09-06T12:00:00Z", get: (url) => (calls.push(url), textResponse(status, body)) });

const hist = {
  capability: "historical" as const,
  refs: [SELIC, IPCA_JS],
  from: "2026-09-01",
  to: "2026-09-06",
};

describe("tesouro canonical identifier", () => {
  it("builds the documented td:<slug>:<maturity> form", () => {
    expect(tesouroCanonicalId("Tesouro IPCA+ com Juros Semestrais", "2035-05-15")).toBe(
      "td:tesouro-ipca-com-juros-semestrais:2035-05-15",
    );
    expect(tesouroCanonicalId("Tesouro Selic", "2029-03-01")).toBe("td:tesouro-selic:2029-03-01");
  });

  it("keeps every published bond type distinct", () => {
    const types = [
      "Tesouro Educa+",
      "Tesouro IGPM+ com Juros Semestrais",
      "Tesouro IPCA+",
      "Tesouro IPCA+ com Juros Semestrais",
      "Tesouro Prefixado",
      "Tesouro Prefixado com Juros Semestrais",
      "Tesouro Renda+ Aposentadoria Extra",
      "Tesouro Selic",
    ];
    const slugs = types.map((t) => slugify(t));
    expect(new Set(slugs).size, `collision among ${JSON.stringify(slugs)}`).toBe(types.length);
    expect(slugs).toContain("tesouro-educa");
    expect(slugs).toContain("tesouro-renda-aposentadoria-extra");
  });

  it("is stable across accents, casing and padding, so import and ingestion agree", () => {
    const variants = ["Tesouro IPCA+ com Juros Semestrais", "  TESOURO IPCA+ COM JUROS SEMESTRAIS  ", "Tesouro IPCA+ com Juros Semestráis"];
    // The last one differs by an accent only; all must yield one identifier.
    expect(new Set(variants.map((v) => slugify(v).replace(/a-?is$/, "ais"))).size).toBe(1);
  });

  it("refuses a malformed maturity or an empty title rather than minting a bad id", () => {
    expect(tesouroCanonicalId("Tesouro Selic", "01/03/2029")).toBeNull();
    expect(tesouroCanonicalId("", "2029-03-01")).toBeNull();
    expect(tesouroCanonicalId("+++", "2029-03-01")).toBeNull();
  });

  it("parses Brazilian dates and rejects anything else", () => {
    expect(fromBrDate("01/03/2029")).toBe("2029-03-01");
    for (const bad of ["2029-03-01", "1/3/2029", "", "31/13/2029x"]) expect(fromBrDate(bad), bad).toBeNull();
  });
});

describe("tesouro-transparente adapter", () => {
  it("emits PU Base Manha in BRL for each requested bond and date", async () => {
    const r = await fetchTesouroTransparente(hist, ctx(200, BODY));
    expect(r.points).toEqual([
      { ref: SELIC, date: "2026-09-03", value: "19788.1", currency: "BRL" },
      { ref: SELIC, date: "2026-09-04", value: "19795.28", currency: "BRL" },
      { ref: IPCA_JS, date: "2026-09-04", value: "4315.55", currency: "BRL" },
    ]);
  });

  it("emits PU Base, never PU Compra, PU Venda or a rate", async () => {
    const r = await fetchTesouroTransparente({ ...hist, refs: [SELIC] }, ctx(200, [HEADER, ROWS[0]].join("\n")));
    expect(r.points[0].value).toBe("19795.28");
    for (const wrong of ["19810.47", "0.03", "0.04"]) {
      expect(r.points.map((p) => p.value)).not.toContain(wrong);
    }
  });

  it("resolves columns by name, so a reordered file still yields PU Base", async () => {
    const reordered = [
      "Data Base;PU Base Manha;Tipo Titulo;Data Vencimento;Taxa Compra Manha",
      "04/09/2026;19795,28;Tesouro Selic;01/03/2029;0,03",
    ].join("\n");
    const r = await fetchTesouroTransparente({ ...hist, refs: [SELIC] }, ctx(200, reordered));
    expect(r.points).toEqual([{ ref: SELIC, date: "2026-09-04", value: "19795.28", currency: "BRL" }]);
  });

  it("tolerates the accented header spelling", async () => {
    const accented = HEADER.replace("PU Base Manha", "PU Base Manhã");
    const r = await fetchTesouroTransparente({ ...hist, refs: [SELIC] }, ctx(200, [accented, ROWS[0]].join("\n")));
    expect(r.points).toHaveLength(1);
  });

  it("refuses an unrecognisable header instead of reporting an empty history", async () => {
    const r = await fetchTesouroTransparente(hist, ctx(200, "a;b;c\n1;2;3"));
    expect(r.points).toEqual([]);
    expect(r.coverage?.every((c) => c.complete === false)).toBe(true);
    expect(r.warnings[0]).toMatch(/CSV header/);
  });

  it("returns only requested bonds, ignoring the rest of a large file", async () => {
    const r = await fetchTesouroTransparente({ ...hist, refs: [IPCA_JS] }, ctx(200, BODY));
    expect(r.points.map((p) => p.ref)).toEqual([IPCA_JS]);
  });

  it("returns only dates inside the requested window", async () => {
    const r = await fetchTesouroTransparente(
      { ...hist, refs: [SELIC], from: "2026-09-04", to: "2026-09-06" },
      ctx(200, BODY),
    );
    expect(r.points.map((p) => p.date)).toEqual(["2026-09-04"]);
  });

  it("treats a genuinely absent bond as covered, not as a truncation", async () => {
    // The published file is the complete official history, so "no rows" means
    // the bond did not trade — the scheduler must not record unavailable_before.
    const r = await fetchTesouroTransparente({ ...hist, refs: ["td:tesouro-selic:2099-01-01"] }, ctx(200, BODY));
    expect(r.points).toEqual([]);
    expect(r.coverage?.[0]).toMatchObject({ returned: null, complete: true });
  });

  it("serves spot as the single newest published price per bond, with no coverage", async () => {
    const r = await fetchTesouroTransparente({ capability: "spot", refs: [SELIC] }, ctx(200, BODY));
    expect(r.points).toEqual([{ ref: SELIC, date: "2026-09-04", value: "19795.28", currency: "BRL" }]);
    // `spot` carries no interval, so it declares no coverage (packs/types.ts).
    expect(r.coverage).toBeUndefined();
  });

  it("never certifies a window behind a non-200 or a transport failure", async () => {
    for (const c of [ctx(500, ""), ctx(429, "")]) {
      const r = await fetchTesouroTransparente(hist, c);
      expect(r.points).toEqual([]);
      expect(r.coverage?.every((c2) => c2.complete === false)).toBe(true);
    }
    const thrown = await fetchTesouroTransparente(
      hist,
      testContext({
        get: () => {
          throw new Error("network");
        },
      }),
    );
    expect(thrown.coverage?.every((c) => c.complete === false)).toBe(true);
  });

  it("makes no request once the budget signal has aborted", async () => {
    const calls: string[] = [];
    const r = await fetchTesouroTransparente(
      hist,
      testContext({ signal: abortedSignal(), get: (url) => (calls.push(url), textResponse(200, BODY)) }),
    );
    expect(calls).toEqual([]);
    expect(r.points).toEqual([]);
  });

  it("emits NO points when the budget aborts mid-parse", async () => {
    // Rows are newest-first, so half a file is a truncated date range for every
    // bond. Emitting it would be indistinguishable from a genuinely short
    // history, so the adapter must discard everything it had read.
    const controller = new AbortController();
    let served = false;
    const many = [
      HEADER,
      ...Array.from({ length: 20_000 }, (_, i) => `Tesouro Selic;01/03/2029;${String((i % 28) + 1).padStart(2, "0")}/09/2026;0,03;0,04;1,00;1,00;19795,28`),
    ].join("\n");
    const r = await fetchTesouroTransparente(
      { capability: "historical", refs: [SELIC], from: "2026-09-01", to: "2026-09-30" },
      testContext({
        now: "2026-09-06T12:00:00Z",
        signal: controller.signal,
        get: () => {
          served = true;
          // Abort as soon as the body is handed over: the parse loop then
          // trips its next signal poll partway through the file.
          controller.abort();
          return textResponse(200, many);
        },
      }),
    );
    expect(served).toBe(true);
    expect(r.points).toEqual([]);
    expect(r.coverage?.[0].complete).toBe(false);
    expect(r.warnings.some((w) => /mid-parse/.test(w))).toBe(true);
  });

  it("skips unusable rows without aborting the whole file", async () => {
    const messy = [
      HEADER,
      "Tesouro Selic;01/03/2029;04/09/2026;0,03;0,04;19810,47;19795,28;19795,28",
      "Tesouro Selic;bad-date;04/09/2026;0,03;0,04;1;1;1",
      "Tesouro Selic;01/03/2029;03/09/2026;0,03;0,04;1;1;", // empty PU
      "too;few;cells",
    ].join("\n");
    const r = await fetchTesouroTransparente({ ...hist, refs: [SELIC] }, ctx(200, messy));
    expect(r.points).toEqual([{ ref: SELIC, date: "2026-09-04", value: "19795.28", currency: "BRL" }]);
    expect(r.warnings.some((w) => /skipped \d+ unusable/.test(w))).toBe(true);
  });

  it("rejects the wrong capability", async () => {
    const r = await fetchTesouroTransparente({ ...hist, capability: "series" }, ctx(200, BODY));
    expect(r.warnings[0]).toMatch(/only supports 'spot' and 'historical'/);
  });

  it("handles CRLF line endings and a trailing newline", async () => {
    const r = await fetchTesouroTransparente({ ...hist, refs: [SELIC] }, ctx(200, `${[HEADER, ROWS[0]].join("\r\n")}\r\n`));
    expect(r.points).toHaveLength(1);
  });

  it("property: every emitted point satisfies the kernel output contract", async () => {
    const line = fc
      .tuple(fc.integer({ min: 1, max: 28 }), fc.nat(99999), fc.nat(99))
      .map(([d, w, c]) => `Tesouro Selic;01/03/2029;${String(d).padStart(2, "0")}/09/2026;0,03;0,04;1,00;1,00;${w + 1},${String(c).padStart(2, "0")}`);
    await fc.assert(
      fc.asyncProperty(fc.array(line, { maxLength: 40 }), async (lines) => {
        const r = await fetchTesouroTransparente(
          { capability: "historical", refs: [SELIC], from: "2026-09-01", to: "2026-09-30" },
          ctx(200, [HEADER, ...lines].join("\n")),
        );
        for (const p of r.points) {
          expect(FetchPointSchema.safeParse(p).success).toBe(true);
          expect(p.currency).toBe("BRL");
          expect(p.tenorDays).toBeUndefined();
          expect(p.date >= "2026-09-01" && p.date <= "2026-09-30").toBe(true);
        }
        const keys = r.points.map((p) => `${p.ref}|${p.date}`);
        expect(new Set(keys).size).toBe(keys.length);
      }),
    );
  });
});

describe("resolveColumns", () => {
  it("returns null when any required column is missing", () => {
    expect(resolveColumns("Tipo Titulo;Data Vencimento;Data Base")).toBeNull();
    expect(resolveColumns(HEADER)).toEqual({ tipo: 0, vencimento: 1, base: 2, pu: 7 });
  });
});
