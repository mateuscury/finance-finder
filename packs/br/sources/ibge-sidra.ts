/**
 * IBGE SIDRA — IPCA número-índice (MILESTONES.md decision 1, 2026-09-06).
 * https://sidra.ibge.gov.br/tabela/1737
 *
 * Table 1737, variable 2266: "IPCA - Número-índice (base: dezembro de 1993 =
 * 100)". This is ALREADY a level, which is the whole point of the decision:
 * BCB SGS 433 publishes a monthly percentage change, and turning that into a
 * level means chaining — arithmetic — which packs never supply (PACKS.md §1).
 * This adapter performs no chaining and no inflation math; it re-spells the
 * published level and dates it.
 *
 * Endpoint shape (verified live 2026-09-06):
 *   GET https://apisidra.ibge.gov.br/values/t/1737/n1/all/v/2266/p/{from}-{to}/h/n
 *   → [{ "V": "7640.1500000000000", "D3C": "202605", ... }, ...]
 *   `/h/n` suppresses SIDRA's leading label row. An unpublished period is `[]`.
 *
 * DATING CONVENTION: a monthly observation is dated the LAST CALENDAR DAY of
 * its reference month. `br.ipca` declares `interpolation: "linear_daily"`, so
 * the kernel interpolates between consecutive month-end anchors; anchoring on
 * the first day instead would shift every interpolated value by a month.
 */
import { coverageFor } from "../../coverage";
import { plainDecimal } from "../../decimal-text";
import type { FetchContext, FetchRequest, FetchResult, PriceSource } from "../../types";

const SIDRA_TABLE = 1737;
const SIDRA_VARIABLE = 2266;
const IPCA = "br.ipca";

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Explicit rather than via `Date`, so the rule is visible and directly testable. */
export function lastDayOfMonth(year: number, month: number): number {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return DAYS_IN_MONTH[month - 1];
}

/** "202605" -> "2026-05-31". Returns null for a malformed period code. */
export function periodToMonthEnd(period: string): string | null {
  const m = /^(\d{4})(\d{2})$/.exec(period.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  return `${m[1]}-${m[2]}-${String(lastDayOfMonth(year, month)).padStart(2, "0")}`;
}

/** Inclusive list of YYYYMM codes spanned by two ISO dates. */
export function monthsBetween(from: string, to: string): string[] {
  const start = Number(from.slice(0, 4)) * 12 + Number(from.slice(5, 7)) - 1;
  const end = Number(to.slice(0, 4)) * 12 + Number(to.slice(5, 7)) - 1;
  const out: string[] = [];
  for (let i = start; i <= end; i++) {
    out.push(`${Math.floor(i / 12)}${String((i % 12) + 1).padStart(2, "0")}`);
  }
  return out;
}

interface SidraRow {
  V?: unknown;
  D3C?: unknown;
}

export async function fetchIbgeSidra(req: FetchRequest, ctx: FetchContext): Promise<FetchResult> {
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

  if (req.capability !== "series") {
    warnings.push(`ibge_sidra only supports 'series', got '${req.capability}'`);
    return result();
  }
  for (const ref of req.refs.filter((r) => r !== IPCA)) {
    warnings.push(`ibge_sidra: no SIDRA mapping for '${ref}'`);
  }
  if (!req.refs.includes(IPCA)) return result();
  if (ctx.signal.aborted) {
    warnings.push("ibge_sidra: time budget exhausted before the request was made");
    return result();
  }

  const months = monthsBetween(from, to);
  if (months.length === 0) {
    warnings.push("ibge_sidra: empty period range requested");
    return result();
  }
  const period = `${months[0]}-${months[months.length - 1]}`;
  const url = `https://apisidra.ibge.gov.br/values/t/${SIDRA_TABLE}/n1/all` + `/v/${SIDRA_VARIABLE}/p/${period}/h/n`;

  let res;
  try {
    res = await ctx.http.get(url, { headers: { accept: "application/json" } });
  } catch {
    warnings.push("ibge_sidra: request failed");
    return result();
  }
  if (res.status !== 200) {
    warnings.push(`ibge_sidra: HTTP ${res.status}`);
    return result();
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    warnings.push("ibge_sidra: response was not JSON");
    return result();
  }
  if (!Array.isArray(body)) {
    warnings.push("ibge_sidra: unexpected payload");
    return result();
  }

  let rejected = 0;
  /** True once a published month lands past `to` — the window's tail is unfinished. */
  let beyondWindow = false;
  const byDate = new Map<string, string>();

  for (const row of body as SidraRow[]) {
    // With /h/n SIDRA still returns its label row on some deployments; it is
    // recognisable because D3C is the literal string "Mês (Código)".
    const period = typeof row.D3C === "string" ? row.D3C : null;
    const date = period === null ? null : periodToMonthEnd(period);
    if (date === null) {
      rejected++;
      continue;
    }
    // SIDRA writes "...", "-" or "X" for unavailable/confidential values.
    // These must be rejected, never coerced to a level.
    const value = typeof row.V === "string" ? plainDecimal(row.V) : null;
    if (value === null || value === "0") {
      rejected++;
      continue;
    }
    if (date < from) continue;
    if (date > to) {
      beyondWindow = true;
      continue;
    }
    byDate.set(date, value);
  }
  if (rejected > 0) warnings.push(`ibge_sidra: rejected ${rejected} row(s) with no usable index level`);

  for (const date of [...byDate.keys()].sort()) {
    points.push({ ref: IPCA, date, value: byDate.get(date)!, currency: null });
  }

  if (beyondWindow) {
    // A month-end anchor exists inside the requested months but past `to`.
    // Refusing to certify keeps the watermark from stepping over a month whose
    // level was published but not requested far enough forward to receive.
    warnings.push("ibge_sidra: a published month ends after the requested window; not certifying coverage");
  } else {
    covered = true;
  }
  return result();
}

export const ibgeSidraSource: PriceSource = {
  id: "br.ibge_sidra",
  label: "IBGE — SIDRA (IPCA número-índice)",
  homepage: "https://sidra.ibge.gov.br/tabela/1737",
  license: "public-domain",
  auth: "none",
  // SIDRA is unauthenticated and tolerant, but IPCA moves once a month: one
  // request per run is all this source ever needs.
  rateLimit: { requests: 2, perSeconds: 1 },
  capabilities: ["series"],
  fetch: fetchIbgeSidra,
};
