import { z } from "zod";
import type { InstrumentKind } from "@/packs/types";
import { PACKS } from "@/packs";
import { INSTANCE_DEFAULTS } from "@/lib/settings/defaults";

/** The metadata keys a kind's schema declares, as a hint for the JSON textarea. */
export function metadataKeys(kind: InstrumentKind): string[] {
  const schema = kind.metadataSchema;
  return schema instanceof z.ZodObject ? Object.keys(schema.shape) : [];
}

export interface AssetFormValues {
  pack_id?: string;
  instrument_kind?: string;
  identifier?: string;
  name?: string;
  native_currency?: string;
  metadata?: unknown;
}

/** The asset form: pack → instrument kind → identifier → native currency (SPEC §9 screen 6). Identity fields are disabled once locked. */
export function AssetForm({
  action,
  values = {},
  lockIdentity = false,
  submitLabel,
}: {
  action: (formData: FormData) => Promise<void>;
  values?: AssetFormValues;
  lockIdentity?: boolean;
  submitLabel: string;
}) {
  const kinds = PACKS.flatMap((p) => p.instruments.map((k) => ({ packId: p.id, kind: k })));
  return (
    <form action={action}>
      <label>
        Pack{" "}
        <select name="pack_id" defaultValue={values.pack_id ?? PACKS[0]?.id} disabled={lockIdentity} required>
          {PACKS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id} — {p.name} ({p.status})
            </option>
          ))}
        </select>
      </label>
      <label>
        Instrument kind{" "}
        <select
          name="instrument_kind"
          defaultValue={values.instrument_kind ?? kinds[0]?.kind.id}
          disabled={lockIdentity}
          required
        >
          {kinds.map(({ packId, kind }) => (
            <option key={kind.id} value={kind.id}>
              {packId} · {kind.label} — metadata: {metadataKeys(kind).join(", ") || "none"}
            </option>
          ))}
        </select>
      </label>
      <label>
        Identifier <input name="identifier" defaultValue={values.identifier ?? ""} disabled={lockIdentity} required />
      </label>
      <label>
        Name <input name="name" defaultValue={values.name ?? ""} required />
      </label>
      <label>
        Native currency{" "}
        <input
          name="native_currency"
          defaultValue={values.native_currency ?? INSTANCE_DEFAULTS.baseCurrency}
          pattern="[A-Z]{3}"
          disabled={lockIdentity}
          required
        />
      </label>
      <label>
        Metadata (JSON){" "}
        <textarea name="metadata" defaultValue={JSON.stringify(values.metadata ?? {}, null, 2)} rows={4} />
      </label>
      {lockIdentity ? (
        <>
          <input type="hidden" name="pack_id" value={values.pack_id} />
          <input type="hidden" name="instrument_kind" value={values.instrument_kind} />
          <input type="hidden" name="identifier" value={values.identifier} />
          <input type="hidden" name="native_currency" value={values.native_currency} />
        </>
      ) : null}
      <button type="submit">{submitLabel}</button>
    </form>
  );
}
