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
