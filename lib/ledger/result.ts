/**
 * Every ledger action returns one of these and never throws to the caller
 * (docs/milestone-3-plan.md "Writes"). Reasons are a CLOSED set so a screen
 * maps one line each; free text from Supabase never reaches the browser.
 */
export type ActionReason =
  /** Field-level validation failed; `fields` names the offenders. */
  | "invalid_input"
  /** No such row for this user — RLS makes "not yours" and "does not exist" the same answer. */
  | "not_found"
  /** `pack_id` / `instrument_kind` is not registered in this build. */
  | "unknown_kind"
  /** Metadata fails the pack's schema. */
  | "invalid_metadata"
  /** Another asset of this user already has that identity. */
  | "duplicate_asset"
  /** Identity fields cannot change once the asset has a transaction (decision 27). */
  | "asset_identity_locked"
  /** An asset with transactions cannot be deleted (decision 27). */
  | "asset_has_transactions"
  /** The base currency locks at the first transaction (decision 26). */
  | "base_locked"
  /** The database refused for a reason the code did not anticipate. */
  | "write_failed";

export type ActionResult<T = undefined> = { ok: true; value: T } | { ok: false; reason: ActionReason; fields?: readonly string[] };

export const ok = <T>(value: T): ActionResult<T> => ({ ok: true, value });
export const fail = <T = undefined>(reason: ActionReason, fields?: readonly string[]): ActionResult<T> => (fields ? { ok: false, reason, fields } : { ok: false, reason });

/** A PostgREST/Postgres error reduced to a reason. The message is never read. */
export function reasonFor(error: { code?: string | null } | null | undefined): ActionReason {
  switch (error?.code) {
    case "23505":
      return "duplicate_asset";
    case "23503":
    case "42501":
    case "PGRST116":
      return "not_found";
    case "23514":
      return "invalid_input";
    default:
      return "write_failed";
  }
}

/** The outcome of an update/delete that `.select()`ed its rows: none affected is `not_found` (RLS or no such row). */
export function fromAffected(res: { data: unknown[] | null; error: { code?: string | null } | null }): ActionResult {
  if (res.error) return fail(reasonFor(res.error));
  return (res.data ?? []).length === 0 ? fail("not_found") : ok(undefined);
}
