/**
 * packs/decimal-text.ts — KERNEL-OWNED, like types.ts, schema.ts and coverage.ts.
 *
 * Upstream feeds publish numbers as text in several dialects: BCB PTAX and
 * Tesouro Transparente use Brazilian notation (`1.234,56`), IBGE SIDRA uses
 * dot-decimals padded with zeros (`7640.1500000000000`).
 *
 * These functions RE-SPELL a decimal lexeme; they never do arithmetic, so they
 * do not breach "packs never supply math" (PACKS.md §1). Crucially, they never
 * let a value touch `parseFloat`/`Number`: the point of the decimal-string
 * boundary is that the exact digits an authority published are the digits that
 * reach the database (CLAUDE.md non-negotiables).
 *
 * Output is always canonical for `DecimalStringSchema`: optional `-`, no
 * exponent, no leading zeros, no trailing fractional zeros, and a single "0".
 */

function canonical(sign: string, whole: string, fraction: string): string | null {
  if (!/^\d+$/.test(whole)) return null;
  if (fraction !== "" && !/^\d+$/.test(fraction)) return null;
  const w = whole.replace(/^0+(?=\d)/, "");
  const f = fraction.replace(/0+$/, "");
  if (w === "0" && f === "") return "0"; // never "-0"
  return f ? `${sign}${w}.${f}` : `${sign}${w}`;
}

/** Normalize an already dot-decimal lexeme: "7640.1500000000000" -> "7640.15". */
export function plainDecimal(input: string): string | null {
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(input.trim());
  if (!m) return null;
  return canonical(m[1] === "-" ? "-" : "", m[2], m[3] ?? "");
}

/**
 * Normalize Brazilian decimal text: "1.234,56" -> "1234.56", "5,157" -> "5.157".
 *
 * A dot is accepted ONLY as a thousands separator in exact three-digit groups.
 * "1.23" is rejected rather than guessed at: in this notation it is malformed,
 * and reading it as one-point-two-three would silently corrupt a price by three
 * orders of magnitude. Surrounding double quotes (as PTAX's CSV emits) are
 * stripped first.
 */
export function decimalFromBrazilianText(input: string): string | null {
  let s = input.trim();
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) s = s.slice(1, -1).trim();
  const m = /^([+-]?)([\d.]*\d)(?:,(\d+))?$/.exec(s);
  if (!m) return null;
  const whole = m[2];
  if (whole.includes(".") && !/^\d{1,3}(\.\d{3})+$/.test(whole)) return null;
  return canonical(m[1] === "-" ? "-" : "", whole.replace(/\./g, ""), m[3] ?? "");
}

/**
 * Split one CSV line, honouring double-quoted fields and `""` escapes.
 * PTAX quotes its decimals precisely because they contain the comma separator.
 */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      out.push(field);
      field = "";
    } else field += c;
  }
  out.push(field);
  return out;
}
