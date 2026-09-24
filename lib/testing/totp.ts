/**
 * RFC 4648 base32 + RFC 6238 TOTP — the same arithmetic an authenticator app
 * does, so a test can pass the MFA challenge without one.
 *
 * Written for `lib/auth/auth.dbtest.ts` (Milestone 3) and moved here by
 * Milestone 4 P7-U1 so the browser journeys enrol a factor with the same
 * generator the database tier verifies with. Test-only: nothing in `app/` or
 * `lib/` outside this directory imports it, and the application never
 * generates a code — it verifies one Supabase checked.
 */
import { createHmac } from "node:crypto";

export function base32Decode(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, "").toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error("bad base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** HMAC-SHA1, 30 s step, 6 digits — Supabase's TOTP parameters. */
export function totp(secretBase32: string, atMs = Date.now(), stepSeconds = 30, digits = 6): string {
  const counter = Math.floor(atMs / 1000 / stepSeconds);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", base32Decode(secretBase32)).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const code = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(code % 10 ** digits).padStart(digits, "0");
}

/**
 * A code that is valid in the NEXT step, for a challenge that refuses a code
 * already used in this one (Supabase rejects a replay within the same step).
 */
export function nextTotp(secretBase32: string, atMs = Date.now(), stepSeconds = 30): string {
  return totp(secretBase32, atMs + stepSeconds * 1000, stepSeconds);
}
