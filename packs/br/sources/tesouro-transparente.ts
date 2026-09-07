/**
 * Tesouro Transparente — daily Tesouro Direto prices and rates (open data CSV).
 * https://www.tesourotransparente.gov.br/ckan/dataset/taxas-dos-titulos-ofertados-pelo-tesouro-direto
 *
 * Licence: ODbL 1.0. Attribution is required and lives in packs/br/README.md.
 *
 * WHAT THIS EMITS (MILESTONES.md decision 2): `PU Base Manha` — the D0 unit
 * price Tesouro itself marks acquired bonds to market at, and the number a
 * broker statement shows. NOT `PU Compra`, NOT `PU Venda`, and NOT a rate.
 * The rate locked at purchase ("marcação na curva") is a different number from
 * market value; it may be stored as display metadata but never values a
 * holding. Accruing at a contracted rate would be a kernel `accrual` feature.
 *
 * IDENTITY: the file identifies a bond by `Tipo Titulo` + `Data Vencimento`.
 * There is no ISIN anywhere in it, so `br.tesouro_direto` uses a `custom`
 * identifier built by `tesouroCanonicalId` below.
 *
 * SIZE: the CSV is a single ~14 MB file with ~176,000 rows covering every bond
 * since 2004. It is scanned by newline index and filtered as rows are read —
 * never split into an array or materialised as objects — and `ctx.signal` is
 * polled throughout so an exhausted budget cancels the parse (plan §0.1, §1.5).
 */
import { coverageFor } from "../../coverage";
import { decimalFromBrazilianText, splitCsvLine } from "../../decimal-text";
import type { FetchContext, FetchRequest, FetchResult, PriceSource } from "../../types";

const CSV_URL =
  "https://www.tesourotransparente.gov.br/ckan/dataset/df56aa42-484a-4a59-8184-7676580c81e3/" +
  "resource/796d2059-14e9-44e3-80c9-2d9e30b405c1/download/PrecoTaxaTesouroDireto.csv";

const QUOTE_CURRENCY = "BRL";
/** Poll the abort signal every this many rows: often enough to stop promptly. */
const SIGNAL_POLL_ROWS = 2048;

/**
 * Slugify a label: lower-case, accents stripped, runs of anything else folded
 * to a single hyphen. Used both for the canonical identifier and for matching
 * CSV headers, so an upstream accent change ("Manha" ⇄ "Manhã") cannot break
 * column lookup.
 */
export function slugify(label: string): string {
  return label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The canonical identifier for a Tesouro Direto holding:
 *   `td:<slugified Tipo Titulo>:<ISO maturity>`
 *   e.g. `td:tesouro-ipca-com-juros-semestrais:2035-05-15`
 *
 * ONE exported function, deliberately: asset creation, CSV import and this
 * adapter must all produce byte-identical ids or a user's holding silently
 * stops being priced.
 */
export function tesouroCanonicalId(tipoTitulo: string, maturityIso: string): string | null {
  const slug = slugify(tipoTitulo);
  if (slug === "" || !/^\d{4}-\d{2}-\d{2}$/.test(maturityIso)) return null;
  return `td:${slug}:${maturityIso}`;
}

/** "01/03/2029" -> "2029-03-01". */
export function fromBrDate(dmy: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(dmy.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

interface Columns {
  tipo: number;
  vencimento: number;
  base: number;
  pu: number;
}

/** Resolve columns by slugified header name, never by position. */
export function resolveColumns(headerLine: string): Columns | null {
  const slugs = splitCsvLine(headerLine, ";").map(slugify);
  const at = (name: string) => slugs.indexOf(name);
  const cols: Columns = {
    tipo: at("tipo-titulo"),
    vencimento: at("data-vencimento"),
    base: at("data-base"),
    pu: at("pu-base-manha"),
  };
  return Object.values(cols).some((i) => i < 0) ? null : cols;
}

export async function fetchTesouroTransparente(req: FetchRequest, ctx: FetchContext): Promise<FetchResult> {
  const warnings: string[] = [];
  const isSpot = req.capability === "spot";
  const today = ctx.now().toISOString().slice(0, 10);
  const from = req.from ?? today;
  const to = req.to ?? today;

  // A `spot` request asks for "the newest price", not for an interval, so it
  // carries no coverage (packs/types.ts). `historical` is bounded and does.
  const emit = (points: FetchResult["points"], covered: boolean): FetchResult =>
    isSpot
      ? { points, warnings }
      : { points, warnings, coverage: coverageFor(req.refs, { from, to }, points, () => covered) };

  if (!isSpot && req.capability !== "historical") {
    warnings.push(`tesouro_transparente only supports 'spot' and 'historical', got '${req.capability}'`);
    return emit([], false);
  }
  const wanted = new Set(req.refs);
  if (wanted.size === 0) return emit([], false);
  if (ctx.signal.aborted) {
    warnings.push("tesouro_transparente: time budget exhausted before the request was made");
    return emit([], false);
  }

  let res;
  try {
    res = await ctx.http.get(CSV_URL, { headers: { accept: "text/csv" } });
  } catch {
    warnings.push("tesouro_transparente: request failed");
    return emit([], false);
  }
  if (res.status !== 200) {
    warnings.push(`tesouro_transparente: HTTP ${res.status}`);
    return emit([], false);
  }

  const body = await res.text();

  // --- incremental scan -----------------------------------------------------
  // Walk the body by newline index. `split("\n")` would allocate ~176,000
  // strings up front; this keeps one line alive at a time.
  const firstBreak = body.indexOf("\n");
  const headerLine = (firstBreak === -1 ? body : body.slice(0, firstBreak)).replace(/\r$/, "");
  const columns = resolveColumns(headerLine);
  if (columns === null) {
    warnings.push("tesouro_transparente: unexpected CSV header");
    return emit([], false);
  }
  const maxColumn = Math.max(columns.tipo, columns.vencimento, columns.base, columns.pu);

  /** ref -> date -> value. Only requested bonds are ever retained. */
  const collected = new Map<string, Map<string, string>>();
  let rows = 0;
  let rejected = 0;
  let cursor = firstBreak === -1 ? body.length : firstBreak + 1;

  while (cursor < body.length) {
    if (++rows % SIGNAL_POLL_ROWS === 0 && ctx.signal.aborted) {
      // Rows are ordered newest-first, so a half-read file yields a truncated
      // date range for every bond. Emitting it would look like a short history
      // rather than an interrupted one, so nothing at all is emitted.
      warnings.push("tesouro_transparente: time budget exhausted mid-parse; no points emitted");
      return emit([], false);
    }
    let end = body.indexOf("\n", cursor);
    if (end === -1) end = body.length;
    const line = body.slice(cursor, end).replace(/\r$/, "");
    cursor = end + 1;
    if (line === "") continue;

    const cells = splitCsvLine(line, ";");
    if (cells.length <= maxColumn) {
      rejected++;
      continue;
    }
    const maturity = fromBrDate(cells[columns.vencimento]);
    if (maturity === null) {
      rejected++;
      continue;
    }
    const ref = tesouroCanonicalId(cells[columns.tipo], maturity);
    // Filter before any further work: the overwhelming majority of rows belong
    // to bonds this run was not asked about.
    if (ref === null || !wanted.has(ref)) continue;

    const date = fromBrDate(cells[columns.base]);
    if (date === null) {
      rejected++;
      continue;
    }
    if (!isSpot && (date < from || date > to)) continue;
    if (isSpot && date > to) continue;

    const value = decimalFromBrazilianText(cells[columns.pu]);
    // A bond with no PU Base on a given day (a non-trading day row) is skipped,
    // never emitted as zero.
    if (value === null || value === "0") {
      rejected++;
      continue;
    }
    let perRef = collected.get(ref);
    if (!perRef) collected.set(ref, (perRef = new Map()));
    perRef.set(date, value);
  }
  if (rejected > 0) warnings.push(`tesouro_transparente: skipped ${rejected} unusable row(s)`);

  const points: FetchResult["points"] = [];
  for (const ref of req.refs) {
    const perRef = collected.get(ref);
    if (!perRef) {
      // Not an error: the file is authoritative, so an absent bond genuinely
      // had no published price in this window.
      continue;
    }
    const dates = [...perRef.keys()].sort();
    // `spot` is the newest published price; `historical` is the whole window.
    for (const date of isSpot ? dates.slice(-1) : dates) {
      points.push({ ref, date, value: perRef.get(date)!, currency: QUOTE_CURRENCY });
    }
  }
  // The published file is the complete official history, so a fully parsed 200
  // covers the window. A bond with no rows before its issue date is a genuine
  // absence, not a truncation — hence `complete: true` with a later
  // `returned.from`, which the scheduler must NOT record as unavailable_before.
  return emit(points, true);
}

export const tesouroTransparenteSource: PriceSource = {
  id: "br.tesouro_transparente",
  label: "Tesouro Transparente",
  homepage: "https://www.tesourotransparente.gov.br/",
  license: "odbl-1.0",
  auth: "none",
  rateLimit: { requests: 1, perSeconds: 10 },
  // No `series`: `br.td_curve` was removed (MILESTONES.md decision 2). Tesouro
  // publishes one rate and one price per BOND per day, not per tenor, so a
  // fixed-tenor curve would require interpolation inside a pack.
  capabilities: ["spot", "historical"],
  fetch: fetchTesouroTransparente,
};
