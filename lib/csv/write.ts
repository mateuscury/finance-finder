/**
 * RFC 4180 writer, the inverse of `parseCsv`: a field is quoted when it
 * contains a comma, a quote, a CR or an LF (a quote is doubled); records end
 * in CRLF. `parseCsv(writeCsv(h, rows))` round-trips exactly — the property
 * test in csv.test.ts. The JSON export's companion CSV is written here so
 * the app's own import reads it back as a no-op (SPEC §12.3).
 */

function encode(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

export function writeCsv(header: readonly string[], rows: readonly (readonly string[])[]): string {
  return [header, ...rows].map((r) => r.map(encode).join(",")).join("\r\n") + "\r\n";
}
