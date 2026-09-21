/**
 * RFC 4180 reader (SPEC §9.1; decision 23): quoted fields, doubled quotes,
 * CRLF or LF, an optional UTF-8 BOM. Hand-written — the format is small
 * and the project prefers reviewed code to a dependency. Fields are
 * returned as the text they were, never trimmed or coerced: `quantity`
 * reaches decimal.js as a string.
 */

export type CsvParseResult =
  | { ok: true; header: string[]; rows: string[][] }
  | { ok: false; reason: "empty" | "unterminated_quote" | "quote_in_unquoted_field"; line: number };

export function parseCsv(text: string): CsvParseResult {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let quoted = false;
  let line = 1;
  let i = 0;
  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      if (ch === "\n") line += 1;
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      if (field !== "") return { ok: false, reason: "quote_in_unquoted_field", line };
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ",") {
      endField();
      i += 1;
      continue;
    }
    if (ch === "\r" || ch === "\n") {
      endRecord();
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      i += 1;
      line += 1;
      continue;
    }
    field += ch;
    i += 1;
  }
  if (quoted) return { ok: false, reason: "unterminated_quote", line };
  // A final record without a trailing newline; a trailing newline leaves nothing pending.
  if (field !== "" || record.length > 0) endRecord();
  // Blank lines are not records.
  const nonEmpty = records.filter((r) => !(r.length === 1 && r[0] === ""));
  if (nonEmpty.length === 0) return { ok: false, reason: "empty", line: 1 };
  const [header, ...rows] = nonEmpty;
  return { ok: true, header, rows };
}
