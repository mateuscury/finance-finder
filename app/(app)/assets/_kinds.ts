import type { MarketPack } from "@/packs/types";
import { fieldsOf, type Field } from "@/lib/forms/zod-fields";

/**
 * The registry as plain data for the asset form (decision 55): the server
 * computes each kind's field descriptors from its zod schema; the zod
 * schema itself never crosses to the client.
 */
export interface KindOption {
  packId: string;
  packName: string;
  packStatus: MarketPack["status"];
  kindId: string;
  label: string;
  identifierSpec: "ticker" | "isin" | "custom";
  quoteCurrency: string;
  fields: Field[];
}

export function kindOptions(registry: readonly MarketPack[]): KindOption[] {
  return registry.flatMap((p) =>
    p.instruments.map((k) => ({
      packId: p.id,
      packName: p.name,
      packStatus: p.status,
      kindId: k.id,
      label: k.label,
      identifierSpec: k.identifier,
      quoteCurrency: k.quoteCurrency,
      fields: fieldsOf(k.metadataSchema),
    })),
  );
}
