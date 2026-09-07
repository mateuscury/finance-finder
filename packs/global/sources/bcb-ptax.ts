/**
 * BCB PTAX — the authoritative USD/BRL fixing (PACKS.md §8, §13).
 * https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/documentacao
 *
 * Lives in `global`, not `br`, because FX between two currencies belongs to no
 * single national market.
 *
 * Endpoint shape (verified against the live service 2026-09-06):
 *   GET .../CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)
 *       ?@dataInicial='MM-DD-YYYY'&@dataFinalCotacao='MM-DD-YYYY'&$format=text/csv
 *   → cotacaoCompra,cotacaoVenda,dataHoraCotacao
 *     "5,1564","5,157",2026-09-01 13:06:03.857125
 *
 * TWO contract notes that differ from the Milestone 1 plan as written, both
 * confirmed against the service's own OData $metadata:
 *
 * 1. There is NO bulletin filter to apply. `CotacaoDolarPeriodo` returns
 *    `TipoCotacaoDolar`, whose only properties are cotacaoCompra, cotacaoVenda
 *    and dataHoraCotacao — it is the closing (Fechamento) series by
 *    construction. `tipoBoletim` exists on the SEPARATE
 *    `TipoCotacaoDolarAberturaOuIntermediario` entity used by the
 *    opening/intermediate function, and asking for it here is a 400.
 * 2. CSV is requested deliberately. The JSON projection returns
 *    `cotacaoVenda: 5.1564` as an IEEE double — the value is already damaged
 *    before this adapter sees it. Only the CSV preserves the decimal lexeme.
 *
 * Dates in the query string are MM-DD-YYYY, not the ISO or dd/MM/yyyy order
 * used elsewhere in this repo.
 */
import { coverageFor } from "../../coverage";
import { decimalFromBrazilianText, splitCsvLine } from "../../decimal-text";
import type { FetchContext, FetchRequest, FetchResult, PriceSource } from "../../types";

const PTAX_SERVICE =
  "https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/" +
  "CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)";

/** The one series this source serves. `cotacaoVenda` is the BRL ask per 1 USD. */
const USDBRL = "global.usdbrl";
/** Quote currency of `global.usdbrl` — BRL units per one USD. */
const QUOTE_CURRENCY = "BRL";

/** "2026-09-01" -> "09-01-2026" (Olinda wants MM-DD-YYYY). */
export function toOlindaDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}-${d}-${y}`;
}

interface PtaxRow {
  date: string;
  value: string;
  /** Full upstream timestamp, used only to break a same-day tie deterministically. */
  observedAt: string;
}

/**
 * Parse the PTAX CSV body. Exported for unit testing: it is the part that has
 * to survive a header change or a locale flip upstream.
 */
export function parsePtaxCsv(body: string): { rows: PtaxRow[]; malformed: number } {
  const lines = body.split(/\r?\n/);
  const rows: PtaxRow[] = [];
  let malformed = 0;

  const header = splitCsvLine(lines[0] ?? "", ",").map((h) => h.trim());
  const venda = header.indexOf("cotacaoVenda");
  const quando = header.indexOf("dataHoraCotacao");
  // A missing header is a contract break, not an empty result: refuse it rather
  // than guessing column positions.
  if (venda === -1 || quando === -1) return { rows: [], malformed: -1 };

  for (const line of lines.slice(1)) {
    if (line.trim() === "") continue;
    const cells = splitCsvLine(line, ",");
    const observedAt = (cells[quando] ?? "").trim();
    const value = decimalFromBrazilianText(cells[venda] ?? "");
    // PTAX timestamps are already Brasília local time, so the leading 10
    // characters are the observation date; no timezone shift is applied.
    const date = observedAt.slice(0, 10);
    if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      malformed++;
      continue;
    }
    rows.push({ date, value, observedAt });
  }
  return { rows, malformed };
}

export async function fetchBcbPtax(req: FetchRequest, ctx: FetchContext): Promise<FetchResult> {
  const points: FetchResult["points"] = [];
  const warnings: string[] = [];
  const today = ctx.now().toISOString().slice(0, 10);
  const from = req.from ?? today;
  const to = req.to ?? today;
  let covered = false;
  const result = (): FetchResult => ({
    points,
    warnings,
    coverage: coverageFor(req.refs, { from, to }, points, () => covered),
  });

  if (req.capability !== "fx" && req.capability !== "historical") {
    warnings.push(`bcb_ptax only supports 'fx' and 'historical', got '${req.capability}'`);
    return result();
  }
  const unknown = req.refs.filter((r) => r !== USDBRL);
  for (const ref of unknown) warnings.push(`bcb_ptax: no PTAX mapping for '${ref}'`);
  if (!req.refs.includes(USDBRL)) return result();
  if (ctx.signal.aborted) {
    warnings.push("bcb_ptax: time budget exhausted before the request was made");
    return result();
  }

  const url =
    `${PTAX_SERVICE}?@dataInicial='${toOlindaDate(from)}'` +
    `&@dataFinalCotacao='${toOlindaDate(to)}'&$format=text/csv`;

  let res;
  try {
    res = await ctx.http.get(url, { headers: { accept: "text/csv" } });
  } catch {
    warnings.push("bcb_ptax: request failed");
    return result();
  }
  if (res.status !== 200) {
    warnings.push(`bcb_ptax: HTTP ${res.status}`);
    return result();
  }

  const { rows, malformed } = parsePtaxCsv(await res.text());
  if (malformed < 0) {
    warnings.push("bcb_ptax: unexpected CSV header");
    return result();
  }
  if (malformed > 0) warnings.push(`bcb_ptax: skipped ${malformed} unparsable row(s)`);

  // Deduplicate by date. CotacaoDolarPeriodo returns one closing quote per day,
  // so a repeat means the upstream contract moved; keep the latest timestamp so
  // the outcome is deterministic instead of order-dependent, and say so.
  const byDate = new Map<string, PtaxRow>();
  let duplicates = 0;
  for (const row of rows) {
    if (row.date < from || row.date > to) continue; // never emit outside the window
    const seen = byDate.get(row.date);
    if (seen) {
      duplicates++;
      if (row.observedAt <= seen.observedAt) continue;
    }
    byDate.set(row.date, row);
  }
  if (duplicates > 0) warnings.push(`bcb_ptax: ${duplicates} duplicate date(s); kept the latest quote each`);

  for (const date of [...byDate.keys()].sort()) {
    points.push({ ref: USDBRL, date, value: byDate.get(date)!.value, currency: QUOTE_CURRENCY });
  }
  // PTAX answers the exact window asked for and does not paginate, so a clean
  // 200 covers it — including a header-only body, which genuinely means "no
  // fixing published in this window" (a weekend, a holiday, or pre-history).
  covered = true;
  return result();
}

export const bcbPtaxSource: PriceSource = {
  id: "global.bcb_ptax",
  label: "BCB — PTAX",
  homepage: "https://dadosabertos.bcb.gov.br/",
  license: "public-domain",
  auth: "none",
  rateLimit: { requests: 10, perSeconds: 1 },
  capabilities: ["fx", "historical"],
  fetch: fetchBcbPtax,
};
