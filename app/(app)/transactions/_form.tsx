import type { AssetListItem } from "@/lib/ledger/queries";
import { INSTANCE_DEFAULTS } from "@/lib/settings/defaults";

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

/** SPEC §2: signed quantity by type; unit_price is the per-unit price, or the cash amount for dividend / interest / fee. */
export function TransactionForm({ action, assets, values = {}, submitLabel }: { action: (formData: FormData) => Promise<void>; assets: readonly AssetListItem[]; values?: TransactionFormValues; submitLabel: string }) {
  return (
    <form action={action}>
      <label>
        Asset{" "}
        <select name="asset_id" defaultValue={values.asset_id ?? assets[0]?.id} required>
          {assets.map((a) => (
            <option key={a.id} value={a.id}>
              {a.identifier} — {a.name} ({a.native_currency})
            </option>
          ))}
        </select>
      </label>
      <label>
        Date <input name="trade_date" type="date" defaultValue={values.trade_date ?? ""} required />
      </label>
      <label>
        Type{" "}
        <select name="type" defaultValue={values.type ?? "buy"} required>
          <option value="buy">buy (quantity &gt; 0)</option>
          <option value="sell">sell (quantity &lt; 0)</option>
          <option value="dividend">dividend (quantity 0, unit price = cash amount)</option>
          <option value="interest">interest (quantity 0, unit price = cash amount)</option>
          <option value="fee">fee (quantity 0, unit price = cash amount)</option>
        </select>
      </label>
      <label>
        Quantity <input name="quantity" inputMode="decimal" defaultValue={values.quantity ?? ""} required />
      </label>
      <label>
        Unit price <input name="unit_price" inputMode="decimal" defaultValue={values.unit_price ?? ""} required />
      </label>
      <label>
        Currency <input name="currency" defaultValue={values.currency ?? assets[0]?.native_currency ?? INSTANCE_DEFAULTS.baseCurrency} pattern="[A-Z]{3}" required />
      </label>
      <label>
        Fees <input name="fees" inputMode="decimal" defaultValue={values.fees ?? "0"} />
      </label>
      <label>
        Note <input name="note" defaultValue={values.note ?? ""} maxLength={500} />
      </label>
      <button type="submit">{submitLabel}</button>
    </form>
  );
}
