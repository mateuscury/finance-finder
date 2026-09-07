/**
 * Secret redaction for pack HTTP (plan §2.2).
 *
 * Applied BEFORE a byte reaches a fixture object, an exception, or a
 * diagnostic — not only before a file is written. A token that has already been
 * interpolated into a URL and then thrown inside an error message has already
 * leaked; redacting at the file boundary would be too late.
 */

/** Value written in place of a secret: `<REDACTED:BRAPI_TOKEN>`. */
export function placeholder(varName: string): string {
  return `<REDACTED:${varName}>`;
}

export interface Redactor {
  text(value: string): string;
  headers(headers: Record<string, string>): Record<string, string>;
}

/**
 * Build a redactor for one source's declared environment variables.
 *
 * Both the raw value and its URL-encoded form are replaced: a token
 * interpolated into a query string may appear percent-encoded, and matching
 * only the raw form would miss it entirely.
 */
export function createRedactor(
  env: Readonly<Record<string, string | undefined>>,
  declaredVars: readonly string[] = Object.keys(env),
): Redactor {
  const replacements: Array<{ needle: string; with: string }> = [];
  for (const name of declaredVars) {
    const value = env[name];
    // Very short values would corrupt unrelated text; a real key is never this
    // short, so skipping them is safer than a broad match.
    if (!value || value.length < 6) continue;
    const forms = new Set([value, encodeURIComponent(value), encodeURI(value)]);
    for (const form of forms) replacements.push({ needle: form, with: placeholder(name) });
  }
  // Longest first, so an overlapping shorter form cannot mask a longer one.
  replacements.sort((a, b) => b.needle.length - a.needle.length);

  const text = (value: string): string => {
    let out = value;
    for (const r of replacements) out = out.split(r.needle).join(r.with);
    return out;
  };

  return {
    text,
    headers(headers) {
      const out: Record<string, string> = {};
      for (const [rawKey, rawValue] of Object.entries(headers)) {
        const key = rawKey.toLowerCase();
        let value = text(rawValue);
        if (key === "authorization") {
          // Normalise even when the value did not match a declared variable, so
          // an unexpected credential can never survive into a fixture.
          const named = declaredVars.find((n) => value.includes(placeholder(n)));
          value = `Bearer ${placeholder(named ?? "SECRET")}`;
        }
        out[key] = value;
      }
      return out;
    },
  };
}
