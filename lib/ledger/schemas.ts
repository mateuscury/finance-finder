/**
 * Form validation at the action boundary, in decimal strings
 * (docs/milestone-3-plan.md "Writes"). Each schema mirrors the database's
 * check constraints so a bad row is rejected with a field name before the
 * database rejects it with a constraint name. Money never becomes a number
 * here: `DecimalStringSchema` accepts text, and `lib/calc` parses it.
 */
import { z } from "zod";
import { CurrencyCodeSchema, DecimalStringSchema, IsoDateSchema, PrefixedIdSchema } from "@/packs/schema";
import { isIsoDate } from "@/lib/calc/dates";

const PackIdSchema = z.string().regex(/^([a-z]{2}|global)$/);
/** A real calendar day, not just the shape. */
const RealDate = IsoDateSchema.refine((d) => isIsoDate(d), "not a calendar day");
const trimmed = (max: number) => z.string().trim().min(1).max(max);

const isPositive = (s: string) => /^[0-9]*[1-9][0-9]*(\.[0-9]+)?$|^[0-9]+\.[0-9]*[1-9][0-9]*$/.test(s);
const isNegative = (s: string) => s.startsWith("-") && isPositive(s.slice(1));
const isZero = (s: string) => /^-?0+(\.0+)?$/.test(s);

export const AssetInputSchema = z.object({
  pack_id: PackIdSchema,
  instrument_kind: PrefixedIdSchema,
  identifier: trimmed(120),
  name: trimmed(200),
  native_currency: CurrencyCodeSchema,
  /** Parsed JSON; validated against the pack's schema by the action. */
  metadata: z.record(z.string(), z.unknown()).default({}),
});
export type AssetInput = z.infer<typeof AssetInputSchema>;

/** What may change on an asset that already has transactions (decision 27). */
export const AssetEditableSchema = AssetInputSchema.pick({ name: true, metadata: true });

export const TransactionInputSchema = z
  .object({
    asset_id: z.uuid(),
    trade_date: RealDate,
    type: z.enum(["buy", "sell", "dividend", "interest", "fee"]),
    quantity: DecimalStringSchema,
    unit_price: DecimalStringSchema.refine(isPositive, "must be positive"),
    currency: CurrencyCodeSchema,
    fees: DecimalStringSchema.refine((s) => !isNegative(s), "must not be negative").default("0"),
    note: z.string().trim().max(500).nullable().default(null),
  })
  .superRefine((t, ctx) => {
    // transactions_quantity_by_type_check, in the same words.
    const want = t.type === "buy" ? isPositive : t.type === "sell" ? isNegative : isZero;
    if (!want(t.quantity)) {
      ctx.addIssue({
        code: "custom",
        path: ["quantity"],
        message: t.type === "buy" ? "must be positive" : t.type === "sell" ? "must be negative" : "must be 0",
      });
    }
  });
export type TransactionInput = z.infer<typeof TransactionInputSchema>;

export const CashFlowInputSchema = z.object({
  date: RealDate,
  amount: DecimalStringSchema.refine((s) => !isZero(s), "must not be zero"),
  note: z.string().trim().max(500).nullable().default(null),
});
export type CashFlowInput = z.infer<typeof CashFlowInputSchema>;

export const ManualPriceInputSchema = z.object({
  asset_id: z.uuid(),
  date: RealDate,
  price: DecimalStringSchema.refine(isPositive, "must be positive"),
});
export type ManualPriceInput = z.infer<typeof ManualPriceInputSchema>;

export const BaseCurrencyInputSchema = z.object({
  base_currency: CurrencyCodeSchema,
  confirmReset: z.boolean().default(false),
});

/** Field names from a zod failure, for `ActionResult.fields`. */
export function failedFields(error: z.ZodError): string[] {
  return [...new Set(error.issues.map((i) => String(i.path[0] ?? "")).filter((p) => p !== ""))];
}

/**
 * The Transactions list's filter (SPEC §9 screen 7; MILESTONES.md §4
 * decision 64). A filter is NAVIGATION, not input: an unusable value is
 * dropped field by field and the rest of the filter still applies, because
 * refusing the whole page over a mistyped date would be the worse answer.
 * Nothing here reaches a write.
 */
export const TransactionFilterSchema = z.object({
  asset: z.uuid().optional(),
  type: z.enum(["buy", "sell", "dividend", "interest", "fee"]).optional(),
  from: RealDate.optional(),
  to: RealDate.optional(),
});
export type TransactionFilter = z.infer<typeof TransactionFilterSchema>;

export function parseTransactionFilter(params: Record<string, string | string[] | undefined>): TransactionFilter {
  const one = (v: string | string[] | undefined) => (typeof v === "string" && v !== "" ? v : undefined);
  const keep = <T>(result: { success: boolean; data?: T }) => (result.success ? result.data : undefined);
  const filter: TransactionFilter = {
    asset: keep(TransactionFilterSchema.shape.asset.safeParse(one(params.asset))),
    type: keep(TransactionFilterSchema.shape.type.safeParse(one(params.type))),
    from: keep(TransactionFilterSchema.shape.from.safeParse(one(params.from))),
    to: keep(TransactionFilterSchema.shape.to.safeParse(one(params.to))),
  };
  // An end before the start would select nothing; keep the start and drop the
  // end, which is what the person meant to narrow.
  if (filter.from && filter.to && filter.to < filter.from) filter.to = undefined;
  return filter;
}

/** Whether any field is set — the list shows its count and a Clear link only then. */
export function hasFilter(filter: TransactionFilter): boolean {
  return Object.values(filter).some((v) => v !== undefined);
}

/** The filter as query parameters, for a pager link that must keep it. */
export function filterQuery(filter: TransactionFilter): Record<string, string> {
  return Object.fromEntries(Object.entries(filter).filter(([, v]) => v !== undefined)) as Record<string, string>;
}
