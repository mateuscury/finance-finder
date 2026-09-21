import type { Copy } from "@/lib/copy";
import styles from "./_form.module.css";

/**
 * SPEC §2 cash_flows: + deposit, − withdrawal, always in the base currency
 * (decision 25), so the currency is shown and never chosen. A Server
 * Component form on the redirect-to-<Notice> pattern (decision 55):
 * `invalid` marks the fields the last action refused.
 */
export function CashFlowForm({
  action,
  baseCurrency,
  values = {},
  invalid = new Set<string>(),
  submitLabel,
  copy,
}: {
  action: (formData: FormData) => Promise<void>;
  baseCurrency: string;
  values?: { date?: string; amount?: string; note?: string | null };
  invalid?: Set<string>;
  submitLabel: string;
  copy: Copy;
}) {
  const c = copy.screens.cashFlows;
  const mark = (name: string) => ({
    "aria-invalid": invalid.has(name) || undefined,
    className: invalid.has(name) ? "field-error" : undefined,
  });
  return (
    <form action={action} className={styles.form}>
      <div className={styles.row}>
        <label>
          {c.fields.date}
          <input name="date" type="date" defaultValue={values.date ?? ""} required {...mark("date")} />
        </label>
        <label>
          {c.amountIn({ currency: baseCurrency })}
          <input
            name="amount"
            inputMode="decimal"
            pattern="-?[0-9]+(\.[0-9]+)?"
            defaultValue={values.amount ?? ""}
            required
            {...mark("amount")}
          />
        </label>
      </div>
      <label>
        {c.fields.note}
        <input name="note" defaultValue={values.note ?? ""} maxLength={500} {...mark("note")} />
      </label>
      <p className="muted">
        <small>{c.signRule}</small>
      </p>
      <button type="submit" className="primary">
        {submitLabel}
      </button>
    </form>
  );
}
