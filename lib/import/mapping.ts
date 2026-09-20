/**
 * The canonical CSV columns (SPEC §9.1) and the header map a user chooses
 * once (decision 24). Column order is irrelevant, unknown columns are
 * ignored, a missing required column is a file-level error.
 */

export const CANONICAL_COLUMNS = ["date", "type", "pack", "instrument_kind", "identifier", "quantity", "unit_price", "currency", "fees", "note"] as const;
export type CanonicalColumn = (typeof CANONICAL_COLUMNS)[number];
export const REQUIRED_COLUMNS: readonly CanonicalColumn[] = ["date", "type", "pack", "instrument_kind", "identifier", "quantity", "unit_price", "currency"];

/** canonical column → the uploaded header that carries it. */
export type ColumnMap = Partial<Record<CanonicalColumn, string>>;

export type MappingResult = { ok: true; indexOf: Record<CanonicalColumn, number | null> } | { ok: false; missing: CanonicalColumn[] };

/**
 * Resolves each canonical column to an index in `header`. A canonical name
 * present in the header maps itself; `map` overrides. Matching is
 * case-insensitive on trimmed headers.
 */
export function resolveColumns(header: readonly string[], map: ColumnMap = {}): MappingResult {
  const norm = (s: string) => s.trim().toLowerCase();
  const indexOfHeader = new Map(header.map((h, i) => [norm(h), i] as const));
  const indexOf = {} as Record<CanonicalColumn, number | null>;
  const missing: CanonicalColumn[] = [];
  for (const col of CANONICAL_COLUMNS) {
    const wanted = norm(map[col] ?? col);
    const idx = indexOfHeader.get(wanted);
    indexOf[col] = idx ?? null;
    if (idx === undefined && REQUIRED_COLUMNS.includes(col)) missing.push(col);
  }
  return missing.length > 0 ? { ok: false, missing } : { ok: true, indexOf };
}

/** The mapping as the settings row stores it: only overrides, validated shape. */
export function normalizeColumnMap(input: unknown): ColumnMap {
  if (input === null || typeof input !== "object") return {};
  const out: ColumnMap = {};
  for (const col of CANONICAL_COLUMNS) {
    const v = (input as Record<string, unknown>)[col];
    if (typeof v === "string" && v.trim() !== "" && v.trim().toLowerCase() !== col) out[col] = v.trim();
  }
  return out;
}
