/**
 * Native-form plumbing for the ledger pages (decision 19): a server action
 * parses FormData, calls the ledger module, and redirects with the outcome
 * in the query string; the page renders it. No client state, no JSON API.
 */
import type { ActionResult } from "@/lib/ledger/result";

/** Named fields as strings; an absent or empty field is null. */
export function formValues<K extends string>(formData: FormData, names: readonly K[]): Record<K, string | null> {
  const out = {} as Record<K, string | null>;
  for (const name of names) {
    const v = formData.get(name);
    out[name] = typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  }
  return out;
}

/** A JSON object from a textarea; empty means `{}`; anything else that is not an object is null. */
export function metadataFromForm(formData: FormData): Record<string, unknown> | null {
  const raw = formData.get("metadata");
  if (typeof raw !== "string" || raw.trim() === "") return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** `?saved=1`, or `?error=<reason>&fields=a,b`. */
export function outcomeQuery(result: ActionResult<unknown>): string {
  if (result.ok) return "?saved=1";
  const fields =
    result.fields && result.fields.length > 0 ? `&fields=${encodeURIComponent(result.fields.join(","))}` : "";
  return `?error=${result.reason}${fields}`;
}

type Search = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | null =>
  typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? null) : null;

export const REASON_COPY: Record<string, string> = {
  invalid_input: "Some fields were not accepted.",
  not_found: "That row does not exist.",
  unknown_kind: "That instrument kind is not registered in this build.",
  invalid_metadata: "The metadata does not match what this instrument kind needs.",
  duplicate_asset: "You already have an asset with that identity.",
  asset_identity_locked: "This asset has transactions; its identity cannot change. Name and metadata can.",
  asset_has_transactions: "This asset has transactions and cannot be deleted.",
  base_locked:
    "The base currency is locked by your first transaction. Confirm the reset to change it and rebuild history.",
  write_failed: "The change was not saved.",
};

/** The outcome a page shows, from its search params. */
export function outcomeFrom(
  searchParams: Search,
): { kind: "saved" } | { kind: "error"; message: string; fields: string[] } | null {
  if (first(searchParams.saved)) return { kind: "saved" };
  const error = first(searchParams.error);
  if (!error) return null;
  const fields = (first(searchParams.fields) ?? "").split(",").filter(Boolean);
  return { kind: "error", message: REASON_COPY[error] ?? REASON_COPY.write_failed, fields };
}
