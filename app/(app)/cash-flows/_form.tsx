/** SPEC §2 cash_flows: + deposit, − withdrawal, in the base currency (decision 25). */
export function CashFlowForm({ action, baseCurrency, values = {}, submitLabel }: { action: (formData: FormData) => Promise<void>; baseCurrency: string; values?: { date?: string; amount?: string; note?: string | null }; submitLabel: string }) {
  return (
    <form action={action}>
      <label>
        Date <input name="date" type="date" defaultValue={values.date ?? ""} required />
      </label>
      <label>
        Amount in {baseCurrency} (+ deposit, − withdrawal) <input name="amount" inputMode="decimal" defaultValue={values.amount ?? ""} required />
      </label>
      <label>
        Note <input name="note" defaultValue={values.note ?? ""} maxLength={500} />
      </label>
      <button type="submit">{submitLabel}</button>
    </form>
  );
}
