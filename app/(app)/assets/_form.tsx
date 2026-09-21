"use client";

import { useActionState, useState } from "react";
import type { ActionReason } from "@/lib/ledger/result";
import { metaName, type Field } from "@/lib/forms/zod-fields";
import type { KindOption } from "./_kinds";
import styles from "./_form.module.css";

export interface AssetFormValues {
  pack_id?: string;
  instrument_kind?: string;
  identifier?: string;
  name?: string;
  native_currency?: string;
  metadata?: unknown;
}

/**
 * What the action returns on failure; on success it redirects (decision 55).
 * `values` echoes the submitted strings — React resets an uncontrolled form
 * after a server action, so the form re-fills from here.
 */
export type AssetFormState = {
  ok: false;
  reason: ActionReason;
  fields?: readonly string[];
  values: Record<string, string>;
} | null;

export interface AssetFormCopy {
  pack: string;
  kind: string;
  identifier: string;
  identifierHint: Record<KindOption["identifierSpec"], string>;
  name: string;
  nativeCurrency: string;
  metadata: string;
  noMetadata: string;
  optional: string;
  saving: string;
  locked: string;
  packStatus: Record<KindOption["packStatus"], string>;
  /** One line per ActionReason, for the failure state. */
  reasons: Record<ActionReason, string>;
}

/**
 * The asset form (SPEC §9 screen 6): pack → instrument kind → the fields the
 * kind's schema declares → identifier → name → currency. The one Client
 * Component form (decision 55): the kind list follows the pack and the
 * fields follow the kind, so it cannot be drawn without state. Without
 * JavaScript it still posts, and the action's redirect lands on <Notice>.
 */
export function AssetForm({
  action,
  kinds,
  values = {},
  lockIdentity = false,
  fixedKind = false,
  submitLabel,
  copy,
}: {
  action: (prev: AssetFormState, formData: FormData) => Promise<AssetFormState>;
  kinds: KindOption[];
  values?: AssetFormValues;
  /** Identity fields disabled and mirrored as hidden inputs (decision 27). */
  lockIdentity?: boolean;
  /** Pack and kind come from elsewhere (the CSV import preview) and are not chosen here. */
  fixedKind?: boolean;
  submitLabel: string;
  copy: AssetFormCopy;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const initialKind = kinds.find((k) => k.kindId === values.instrument_kind) ?? kinds[0];
  const [packId, setPackId] = useState(values.pack_id ?? initialKind?.packId ?? "");
  const [kindId, setKindId] = useState(initialKind?.kindId ?? "");
  const packs = [...new Map(kinds.map((k) => [k.packId, k])).values()];
  const kindsOfPack = kinds.filter((k) => k.packId === packId);
  const kind = kinds.find((k) => k.kindId === kindId) ?? kindsOfPack[0];
  const invalid = new Set(state && !state.ok ? (state.fields ?? []) : []);
  const echoed = state && !state.ok ? state.values : {};
  /** Pack and kind are fixed when locked or when the CSV chose them; identifier and currency only when locked. */
  const kindDisabled = lockIdentity || fixedKind;
  const metadata = (values.metadata ?? {}) as Record<string, unknown>;
  const initial = (name: string, fallback: string) => echoed[name] ?? fallback;

  const choosePack = (id: string) => {
    setPackId(id);
    const firstKind = kinds.find((k) => k.packId === id);
    if (firstKind) setKindId(firstKind.kindId);
  };
  const field = (f: Field) => {
    const name = metaName(f.name);
    const current: unknown = echoed[name] ?? metadata[f.name];
    const bad = invalid.has("metadata") || invalid.has(f.name);
    const label = (
      <>
        {f.label}
        {f.required ? null : <span className="muted"> ({copy.optional})</span>}
      </>
    );
    if (f.kind === "checkbox") {
      return (
        <label key={f.name} className={styles.check}>
          <input
            type="checkbox"
            name={name}
            defaultChecked={current === true || current === "on"}
            aria-invalid={bad || undefined}
          />{" "}
          {label}
        </label>
      );
    }
    if (f.kind === "select") {
      return (
        <label key={f.name}>
          {label}
          <select
            name={name}
            defaultValue={typeof current === "string" ? current : ""}
            required={f.required}
            aria-invalid={bad || undefined}
          >
            {f.required ? null : <option value="">—</option>}
            {f.options?.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </label>
      );
    }
    return (
      <label key={f.name}>
        {label}
        <input
          name={name}
          type={f.kind === "date" ? "date" : "text"}
          inputMode={f.kind === "decimal" ? "decimal" : undefined}
          pattern={f.kind === "decimal" ? "-?[0-9]+(\\.[0-9]+)?" : undefined}
          defaultValue={typeof current === "string" ? current : ""}
          required={f.required}
          aria-invalid={bad || undefined}
          className={bad ? styles.fieldError : undefined}
        />
      </label>
    );
  };

  return (
    <form action={formAction} className={styles.form}>
      {state && !state.ok ? <p role="alert">{copy.reasons[state.reason] ?? copy.reasons.write_failed}</p> : null}
      {lockIdentity ? <p className="muted">{copy.locked}</p> : null}

      <div className={styles.row}>
        <label>
          {copy.pack}
          <select
            name="pack_id"
            value={packId}
            onChange={(e) => choosePack(e.target.value)}
            disabled={kindDisabled}
            required
          >
            {packs.map((p) => (
              <option key={p.packId} value={p.packId}>
                {p.packName} · {copy.packStatus[p.packStatus]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {copy.kind}
          <select
            name="instrument_kind"
            value={kindId}
            onChange={(e) => setKindId(e.target.value)}
            disabled={kindDisabled}
            required
            aria-invalid={invalid.has("instrument_kind") || undefined}
          >
            {kindsOfPack.map((k) => (
              <option key={k.kindId} value={k.kindId}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <label>
        {copy.identifier}
        <input
          name="identifier"
          defaultValue={initial("identifier", values.identifier ?? "")}
          disabled={kindDisabled}
          required
          aria-invalid={invalid.has("identifier") || undefined}
          className={invalid.has("identifier") ? styles.fieldError : undefined}
          aria-describedby="identifier-hint"
        />
        <small id="identifier-hint" className="muted">
          {kind ? copy.identifierHint[kind.identifierSpec] : null}
        </small>
      </label>
      <label>
        {copy.name}
        <input
          name="name"
          defaultValue={initial("name", values.name ?? "")}
          required
          aria-invalid={invalid.has("name") || undefined}
          className={invalid.has("name") ? styles.fieldError : undefined}
        />
      </label>
      <label>
        {copy.nativeCurrency}
        <input
          name="native_currency"
          key={`${kind?.kindId}-${values.native_currency ?? ""}`}
          defaultValue={initial("native_currency", values.native_currency ?? kind?.quoteCurrency ?? "")}
          pattern="[A-Z]{3}"
          disabled={lockIdentity}
          required
          aria-invalid={invalid.has("native_currency") || undefined}
          className={styles.currency}
        />
      </label>

      <fieldset key={kind?.kindId}>
        <legend>{copy.metadata}</legend>
        {kind && kind.fields.length > 0 ? kind.fields.map(field) : <p className="muted">{copy.noMetadata}</p>}
      </fieldset>

      {/* A disabled input is not submitted: mirror what is fixed. */}
      {kindDisabled ? (
        <>
          <input type="hidden" name="pack_id" value={packId} />
          <input type="hidden" name="instrument_kind" value={kindId} />
          <input type="hidden" name="identifier" value={values.identifier ?? ""} />
        </>
      ) : null}
      {lockIdentity ? <input type="hidden" name="native_currency" value={values.native_currency ?? ""} /> : null}
      <button type="submit" className="primary" disabled={pending}>
        {pending ? copy.saving : submitLabel}
      </button>
    </form>
  );
}
