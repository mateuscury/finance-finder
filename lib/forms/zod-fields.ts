/**
 * Form fields from a pack's `metadataSchema` (SPEC §9 screen 6; MILESTONES.md
 * §4 decisions 45, 55). The asset form renders whatever shape a kind
 * declares, so a new kind — in any pack — gets its fields with no UI change.
 *
 * Detection reads the zod v4 shape: an `optional()` unwraps to the SAME
 * schema instance, so identity with the kernel's `DecimalStringSchema` and
 * `IsoDateSchema` (packs/schema.ts) names the two typed fields; an enum
 * becomes a select, a boolean a checkbox, any other string a text input.
 * A `z.number()` is refused — values are strings, never floats (CLAUDE.md).
 */
import { z, type ZodType } from "zod";
import { DecimalStringSchema, IsoDateSchema } from "@/packs/schema";

export type FieldKind = "text" | "decimal" | "date" | "select" | "checkbox";

export interface Field {
  name: string;
  /** The key humanised: `purchaseRate` → "Purchase rate". */
  label: string;
  kind: FieldKind;
  required: boolean;
  options?: string[];
}

function humanise(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function unwrap(schema: ZodType): { inner: ZodType; required: boolean } {
  let inner: ZodType = schema;
  let required = true;
  // Optional and nullable wrappers, in any order.
  for (;;) {
    if (inner instanceof z.ZodOptional) {
      inner = inner.unwrap() as ZodType;
      required = false;
    } else if (inner instanceof z.ZodNullable) {
      inner = inner.unwrap() as ZodType;
      required = false;
    } else if (inner instanceof z.ZodDefault) {
      inner = inner.unwrap() as ZodType;
      required = false;
    } else break;
  }
  return { inner, required };
}

function kindOf(name: string, inner: ZodType): { kind: FieldKind; options?: string[] } {
  if (inner === DecimalStringSchema) return { kind: "decimal" };
  if (inner === IsoDateSchema) return { kind: "date" };
  const def = (inner as { def: { type: string; format?: string } }).def;
  if (def.type === "string" && def.format === "date") return { kind: "date" };
  if (def.type === "string") return { kind: "text" };
  if (def.type === "enum") return { kind: "select", options: Object.values((inner as z.ZodEnum).enum) as string[] };
  if (def.type === "boolean") return { kind: "checkbox" };
  throw new Error(
    `unsupported_metadata_field: ${name} — metadata values are strings, enums or booleans (a ${def.type} is not)`,
  );
}

/** One field per key of a `z.object(...)` schema; nothing for any other schema. */
export function fieldsOf(schema: ZodType): Field[] {
  if (!(schema instanceof z.ZodObject)) return [];
  return Object.entries(schema.shape as Record<string, ZodType>).map(([name, s]) => {
    const { inner, required } = unwrap(s);
    const { kind, options } = kindOf(name, inner);
    return options
      ? { name, label: humanise(name), kind, required, options }
      : { name, label: humanise(name), kind, required };
  });
}

/** The form-field name for a metadata key: prefixed so it never collides with the asset's own fields. */
export const metaName = (name: string) => `meta_${name}`;

/**
 * The metadata object from a submitted form: strings trimmed, an empty
 * optional field omitted, a checkbox a boolean. Never a number — the
 * pack's schema validates the strings, and the kernel parses decimals.
 */
export function valuesFromForm(fields: readonly Field[], formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = formData.get(metaName(f.name));
    if (f.kind === "checkbox") {
      out[f.name] = raw === "on" || raw === "true";
      continue;
    }
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value === "") {
      if (f.required) out[f.name] = "";
      continue;
    }
    out[f.name] = value;
  }
  return out;
}
