/**
 * Kernel zod schema for MarketPack manifests (PACKS.md §11.1).
 * Runtime twin of packs/types.ts — keep the two in sync.
 */
import { z, ZodType } from "zod";
import { PACK_API_VERSION } from "./types";

export const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, "currency must be ISO 4217 (three upper-case letters)");

export const DecimalStringSchema = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "value must be a plain decimal string, never a float or exponent");

export const IsoDateSchema = z.iso.date();

export const DayCountSchema = z.enum(["BUS/252", "ACT/365", "ACT/360", "30/360"]);

const PackIdSchema = z
  .string()
  .regex(/^([a-z]{2}|global)$/, "pack id must be lower-case ISO 3166-1 alpha-2 or 'global'");

/** 'br.cdi' — lower-case, dot-separated, first segment is the pack id. */
export const PrefixedIdSchema = z
  .string()
  .regex(/^([a-z]{2}|global)\.[a-z0-9_]+(\.[a-z0-9_]+)*$/, "ids must be '<pack>.<name>'");

export const AccrualConventionSchema = z.object({
  dayCount: DayCountSchema,
  compounding: z.enum(["daily", "monthly", "annual"]),
  index: z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("percent_of_index"), seriesId: PrefixedIdSchema }),
      z.object({ mode: z.literal("index_plus_spread"), seriesId: PrefixedIdSchema }),
    ])
    .optional(),
});

export const ValuationStrategySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("market_price"), sourceId: PrefixedIdSchema }),
  z.object({ kind: z.literal("nav_unit_price"), sourceId: PrefixedIdSchema }),
  z.object({ kind: z.literal("accrual"), convention: AccrualConventionSchema }),
  z.object({ kind: z.literal("curve_mark_to_market"), seriesId: PrefixedIdSchema }),
]);

export const SeriesKindSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("rate_daily"), dayCount: DayCountSchema }),
  z.object({ kind: z.literal("rate_annual"), dayCount: DayCountSchema }),
  z.object({ kind: z.literal("index_level") }),
  z.object({ kind: z.literal("inflation_index"), interpolation: z.enum(["none", "linear_daily"]) }),
  z.object({ kind: z.literal("fx_rate"), base: CurrencyCodeSchema, quote: CurrencyCodeSchema }),
  z.object({
    kind: z.literal("yield_curve"),
    tenors: z
      .array(z.number().int().positive())
      .min(1)
      .refine((values) => new Set(values).size === values.length, "yield-curve tenors must be unique"),
  }),
]);

export const SeriesRoleSchema = z.enum(["benchmark", "deflator", "accrual_index", "discount_curve", "fx"]);

export const SeriesDescriptorSchema = z.object({
  id: PrefixedIdSchema,
  label: z.string().min(1),
  kind: SeriesKindSchema,
  sourceId: PrefixedIdSchema,
  roles: z.array(SeriesRoleSchema),
});

/**
 * Structural adapter-output validation. The ingestion layer additionally checks
 * `tenorDays` against the referenced series kind and rejects future dates.
 */
export const FetchPointSchema = z.object({
  ref: z.string().min(1),
  date: IsoDateSchema,
  value: DecimalStringSchema,
  currency: CurrencyCodeSchema.nullable(),
  tenorDays: z.number().int().positive().optional(),
});

/**
 * Runtime twin of `RefCoverage`. The `superRefine` encodes the invariants the
 * scheduler relies on, so a malformed coverage claim is rejected at the pack
 * boundary rather than silently advancing a watermark (plan §2.3, §3.2).
 */
export const RefCoverageSchema = z
  .object({
    ref: z.string().min(1),
    requested: z.object({ from: IsoDateSchema, to: IsoDateSchema }),
    returned: z.object({ from: IsoDateSchema, to: IsoDateSchema }).nullable(),
    complete: z.boolean(),
    unavailableBefore: IsoDateSchema.optional(),
  })
  .superRefine((c, ctx) => {
    if (c.requested.from > c.requested.to) {
      ctx.addIssue({ code: "custom", message: "requested.from must not be after requested.to" });
    }
    if (c.unavailableBefore !== undefined && c.complete) {
      // "I covered the whole window" and "I cannot reach part of it" cannot
      // both be true.
      ctx.addIssue({ code: "custom", message: "a complete result cannot declare unavailableBefore" });
    }
    if (c.returned === null) return;
    if (c.unavailableBefore !== undefined && c.returned.from < c.unavailableBefore) {
      ctx.addIssue({ code: "custom", message: "returned data cannot predate unavailableBefore" });
    }
    if (c.returned.from > c.returned.to) {
      ctx.addIssue({ code: "custom", message: "returned.from must not be after returned.to" });
    }
    // A source may not claim to have returned data outside what it asked for.
    if (c.returned.from < c.requested.from || c.returned.to > c.requested.to) {
      ctx.addIssue({ code: "custom", message: "returned interval must lie inside requested" });
    }
  });

export const FetchResultSchema = z.object({
  points: z.array(FetchPointSchema),
  warnings: z.array(z.string()),
  coverage: z.array(RefCoverageSchema).optional(),
});

const isFunction = (v: unknown): v is (...args: unknown[]) => unknown => typeof v === "function";

export const InstrumentKindSchema = z.object({
  id: PrefixedIdSchema,
  label: z.string().min(1),
  valuation: ValuationStrategySchema,
  metadataSchema: z.custom<ZodType>((v) => v instanceof ZodType, "metadataSchema must be a zod schema"),
  identifier: z.enum(["isin", "ticker", "custom"]),
  quoteCurrency: CurrencyCodeSchema,
});

export const PriceSourceSchema = z.object({
  id: PrefixedIdSchema,
  label: z.string().min(1),
  homepage: z.url(),
  license: z.string().min(1),
  auth: z.enum(["none", "api_key"]),
  envVars: z.array(z.string().regex(/^[A-Z][A-Z0-9_]*$/)).optional(),
  rateLimit: z.object({
    requests: z.number().int().positive(),
    perSeconds: z.number().int().positive(),
  }),
  capabilities: z.array(z.enum(["spot", "historical", "series", "fx"])).min(1),
  fetch: z.custom<PriceSourceFetch>(isFunction, "fetch must be a function"),
});
type PriceSourceFetch = import("./types").PriceSource["fetch"];

export const MarketCalendarSchema = z.object({
  timezone: z.string().min(1),
  weekend: z.array(z.number().int().min(0).max(6)),
  holidays: z.custom<(year: number) => string[]>(isFunction, "holidays must be a function"),
  settlement: z.enum(["T+0", "T+1", "T+2"]),
});

export const MarketPackSchema = z.object({
  apiVersion: z.literal(PACK_API_VERSION),
  id: PackIdSchema,
  name: z.string().min(1),
  currency: CurrencyCodeSchema,
  locale: z.string().min(2),
  instruments: z.array(InstrumentKindSchema),
  series: z.array(SeriesDescriptorSchema),
  sources: z.array(PriceSourceSchema),
  calendar: MarketCalendarSchema,
  maintainers: z.array(z.string().min(1)).min(1),
  status: z.enum(["draft", "supported", "unmaintained"]),
  dependencies: z.array(PackIdSchema).optional(),
});

/**
 * PACKS.md §5: the ONE place a pack's metadata is not free-form. Any instrument
 * kind using `curve_mark_to_market` must accept at least this shape.
 * The conformance suite checks it behaviourally: a canonical sample must parse
 * and an empty object must fail.
 */
export const CurveMetadataBaseSchema = z.object({
  maturity: IsoDateSchema,
  coupon: z
    .object({
      rate: DecimalStringSchema,
      frequency: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(12)]),
    })
    .nullable(),
  indexation: z.object({ seriesId: PrefixedIdSchema }).nullable(),
});

export const CURVE_METADATA_SAMPLE = {
  maturity: "2035-05-15",
  coupon: { rate: "0.06", frequency: 2 },
  indexation: null,
} as const;
