import { timingSafeEqual } from "node:crypto";

/**
 * Cron routes eventually run with the Supabase service role, so authentication
 * must fail closed. In particular, an absent environment variable must never
 * turn into the valid-looking string `Bearer undefined`.
 */
const MIN_CRON_SECRET_BYTES = 32;

export function isCronAuthorized(request: Request, secret = process.env.CRON_SECRET): boolean {
  if (!secret || Buffer.byteLength(secret, "utf8") < MIN_CRON_SECRET_BYTES) return false;

  const provided = request.headers.get("authorization");
  if (!provided) return false;

  const expectedBytes = Buffer.from(`Bearer ${secret}`, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");
  return expectedBytes.length === providedBytes.length && timingSafeEqual(expectedBytes, providedBytes);
}
