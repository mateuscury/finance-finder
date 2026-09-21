import { describe, expect, it } from "vitest";
import { z } from "zod";
import { PACKS } from "@/packs";
import { brPack } from "@/packs/br";
import { DecimalStringSchema, IsoDateSchema } from "@/packs/schema";
import { goldenLedgerRead, loadGoldenFixture } from "@/lib/testing/golden";
import { fieldsOf, metaName, valuesFromForm } from "./zod-fields";

const kind = (id: string) => brPack.instruments.find((k) => k.id === id)!;
const kinds = (f: ReturnType<typeof fieldsOf>) => f.map((x) => `${x.name}:${x.kind}${x.required ? "" : "?"}`);

describe("fieldsOf", () => {
  it("reads every in-repo metadata schema into typed fields, by shape alone", () => {
    expect(kinds(fieldsOf(kind("br.tesouro_direto").metadataSchema))).toEqual([
      "titulo:text",
      "maturity:date",
      "purchaseRate:decimal?",
    ]);
    expect(kinds(fieldsOf(kind("br.cdb").metadataSchema))).toEqual([
      "issuer:text",
      "rate:decimal",
      "maturity:date",
      "liquidityFrom:date?",
    ]);
    expect(kinds(fieldsOf(kind("br.fii").metadataSchema))).toEqual(["fundName:text", "segment:text?"]);
    expect(kinds(fieldsOf(kind("br.stock").metadataSchema))).toEqual(["name:text"]);
    for (const p of PACKS) for (const k of p.instruments) expect(() => fieldsOf(k.metadataSchema)).not.toThrow();
  });

  it("humanises labels, maps enums to selects and booleans to checkboxes, and yields nothing for a non-object", () => {
    const schema = z.object({
      couponFrequency: z.enum(["annual", "semiannual"]),
      inflationLinked: z.boolean().optional(),
      isin_code: z.string(),
      firstCoupon: z.iso.date().nullable(),
      spread: DecimalStringSchema.default("0"),
    });
    expect(fieldsOf(schema)).toEqual([
      {
        name: "couponFrequency",
        label: "Coupon frequency",
        kind: "select",
        required: true,
        options: ["annual", "semiannual"],
      },
      { name: "inflationLinked", label: "Inflation linked", kind: "checkbox", required: false },
      { name: "isin_code", label: "Isin code", kind: "text", required: true },
      { name: "firstCoupon", label: "First coupon", kind: "date", required: false },
      { name: "spread", label: "Spread", kind: "decimal", required: false },
    ]);
    expect(fieldsOf(z.string())).toEqual([]);
    expect(fieldsOf(IsoDateSchema)).toEqual([]);
  });

  it("refuses a number field: metadata values are strings", () => {
    expect(() => fieldsOf(z.object({ rate: z.number() }))).toThrow(/unsupported_metadata_field: rate/);
  });
});

describe("valuesFromForm", () => {
  it("round-trips every golden asset's metadata through a form", () => {
    const { fixture } = loadGoldenFixture();
    const read = goldenLedgerRead(fixture, PACKS);
    for (const asset of read.assets) {
      const fields = fieldsOf(asset.instrumentKind.metadataSchema);
      const form = new FormData();
      for (const [k, v] of Object.entries(asset.metadata as Record<string, string>)) form.set(metaName(k), ` ${v} `);
      expect(valuesFromForm(fields, form), asset.id).toEqual(asset.metadata);
      expect(asset.instrumentKind.metadataSchema.safeParse(valuesFromForm(fields, form)).success, asset.id).toBe(true);
    }
  });

  it("omits an empty optional, keeps an empty required (so the schema names it), reads a checkbox as a boolean, never a number", () => {
    const fields = fieldsOf(
      z.object({ name: z.string(), segment: z.string().optional(), rate: DecimalStringSchema, hedged: z.boolean() }),
    );
    const form = new FormData();
    form.set("meta_name", "");
    form.set("meta_segment", "   ");
    form.set("meta_rate", "0.12");
    form.set("meta_hedged", "on");
    expect(valuesFromForm(fields, form)).toEqual({ name: "", rate: "0.12", hedged: true });
    expect(typeof valuesFromForm(fields, form).rate).toBe("string");
  });
});
