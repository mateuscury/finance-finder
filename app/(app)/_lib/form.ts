/**
 * Native-form plumbing for the ledger pages (decision 19): a server action
 * parses FormData, calls the ledger module, and redirects with the outcome
 * in the query string; the page renders it. No client state, no JSON API.
 */
import type { Copy } from "@/lib/copy";
import type { ActionReason, ActionResult } from "@/lib/ledger/result";

/** Named fields as strings; an absent or empty field is null. */
export function formValues<K extends string>(formData: FormData, names: readonly K[]): Record<K, string | null> {
  const out = {} as Record<K, string | null>;
  for (const name of names) {
    const v = formData.get(name);
    out[name] = typeof v === "string" && v.trim() !== "" ? v.trim() : null;
  }
  return out;
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

/** The outcome a page shows, from its search params. */
export function outcomeFrom(
  searchParams: Search,
  copy: Copy,
): { kind: "saved" } | { kind: "error"; message: string; fields: string[] } | null {
  if (first(searchParams.saved)) return { kind: "saved" };
  const error = first(searchParams.error);
  if (!error) return null;
  const fields = (first(searchParams.fields) ?? "").split(",").filter(Boolean);
  const message = copy.reasons[error as ActionReason] ?? copy.reasons.write_failed;
  return { kind: "error", message, fields };
}
