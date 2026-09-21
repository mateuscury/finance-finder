import type { Copy } from "@/lib/copy";
import type { AssetListItem } from "@/lib/ledger/queries";
import { INSTANCE_DEFAULTS } from "@/lib/settings/defaults";
import styles from "./_form.module.css";

export interface TransactionFormValues {
  asset_id?: string;
  trade_date?: string;
  type?: string;
  quantity?: string;
  unit_price?: string;
  currency?: string;
  fees?: string;
  note?: string | null;
}

const TYPES = ["buy", "sell", "dividend", "interest", "fee"] as const;

/**
 * SPEC §2: signed quantity by type; unit_price is the per-unit price, or the
 * cash amount for dividend / interest / fee. A Server Component form on the
 * redirect-to-<Notice> pattern (decision 55): `invalid` marks the fields the
 * last action refused. `fx_rate` is deliberately absent (D-28: display-only,
 * never populated by a form).
 */
export function TransactionForm({
  action,
  assets,
  values = {},
  invalid = new Set<string>(),
  submitLabel,
  copy,
}: {
  action: (formData: FormData) => Promise<void>;
  assets: readonly AssetListItem[];
  values?: TransactionFormValues;
  invalid?: Set<string>;
  submitLabel: string;
  copy: Copy;
}) {
  const c = copy.screens.transactions;
  const mark = (name: string) => ({
    "aria-invalid": invalid.has(name) || undefined,
    className: invalid.has(name) ? "field-error" : undefined,
  });
  const selected = assets.find((a) => a.id === values.asset_id) ?? assets[0];
  return (
    <form action={action} className={styles.form}>
      <label>
        {c.fields.asset}
        <select name="asset_id" defaultValue={selected?.id} required {...mark("asset_id")}>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.identifier} — {a.name} ({a.native_currency})
            </option>
          ))}
        </select>
      </label>
      <div className={styles.row}>
        <label>
          {c.fields.date}
          <input
            name="trade_date"
            type="date"
            defaultValue={values.trade_date ?? ""}
            required
            {...mark("trade_date")}
          />
        </label>
        <label>
          {c.fields.type}
          <select name="type" defaultValue={values.type ?? "buy"} required {...mark("type")}>
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {c.types[t]} — {c.typeHelp[t]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className={styles.row}>
        <label>
          {c.fields.quantity}
          <input
            name="quantity"
            inputMode="decimal"
            pattern="-?[0-9]+(\.[0-9]+)?"
            defaultValue={values.quantity ?? ""}
            required
            {...mark("quantity")}
          />
        </label>
        <label>
          {c.fields.unitPrice}
          <input
            name="unit_price"
            inputMode="decimal"
            pattern="[0-9]+(\.[0-9]+)?"
            defaultValue={values.unit_price ?? ""}
            required
            {...mark("unit_price")}
          />
        </label>
      </div>
      <div className={styles.row}>
        <label>
          {c.fields.currency}
          <input
            name="currency"
            defaultValue={values.currency ?? selected?.native_currency ?? INSTANCE_DEFAULTS.baseCurrency}
            pattern="[A-Z]{3}"
            required
            className={`${styles.currency} ${invalid.has("currency") ? "field-error" : ""}`}
            aria-invalid={invalid.has("currency") || undefined}
          />
        </label>
        <label>
          {c.fields.fees}
          <input
            name="fees"
            inputMode="decimal"
            pattern="[0-9]+(\.[0-9]+)?"
            defaultValue={values.fees ?? "0"}
            {...mark("fees")}
          />
        </label>
      </div>
      <label>
        {c.fields.note}
        <input name="note" defaultValue={values.note ?? ""} maxLength={500} {...mark("note")} />
      </label>
      <p className="muted">
        <small>{c.fxNote}</small>
      </p>
      <button type="submit" className="primary">
        {submitLabel}
      </button>
    </form>
  );
}
