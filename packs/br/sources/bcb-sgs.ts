/**
 * Banco Central do Brasil — Sistema Gerenciador de Séries Temporais (SGS).
 * https://dadosabertos.bcb.gov.br/dataset/
 *
 * Endpoint shape:
 *   GET https://api.bcb.gov.br/dados/serie/bcdata.sgs.{code}/dados
 *       ?formato=json&dataInicial=dd/MM/yyyy&dataFinal=dd/MM/yyyy
 *   → [{ "data": "01/02/2024", "valor": "0.040168" }, ...]
 *
 * An empty window is reported as HTTP 404 with an "SGSNegocioException:
 * Value(s) not found" body, not as `200 []` — see the handling below.
 *
 * Values arrive as decimal strings in percentage points. Rate series are
 * normalized here to the pack contract's unit-rate representation without ever
 * passing through a JS number. SGS 433 (IPCA) is deliberately rejected for now:
 * it is a monthly variation, while `inflation_index` requires an index level.
 */
import { coverageFor } from "../../coverage";
import type { FetchContext, FetchRequest, FetchResult, PriceSource } from "../../types";

/** series id → SGS code. Kept here so series.ts stays a pure declaration. */
const SGS_CODES: Record<string, number> = {
  "br.cdi": 12, // CDI, % ao dia
  "br.selic": 11, // SELIC, % ao dia
  "br.ipca": 433, // IPCA, variação mensal % — see README quirks
};

function toBcbDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function fromBcbDate(dmy: string): string {
  const [d, m, y] = dmy.split("/");
  return `${y}-${m}-${d}`;
}

/** Exact string-only division by 100: "0.045513" -> "0.00045513". */
export function percentagePointsToUnitRate(input: string): string | null {
  const value = input.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;

  const [, sign, whole, fraction = ""] = match;
  const scale = fraction.length + 2;
  const digits = `${whole}${fraction}`.padStart(scale + 1, "0");
  const integerPart = digits.slice(0, -scale).replace(/^0+(?=\d)/, "");
  const fractionalPart = digits.slice(-scale).replace(/0+$/, "");
  const normalized = fractionalPart ? `${integerPart}.${fractionalPart}` : integerPart;
  return normalized === "0" ? "0" : `${sign}${normalized}`;
}

export async function fetchBcbSgs(req: FetchRequest, ctx: FetchContext): Promise<FetchResult> {
  const points: FetchResult["points"] = [];
  const warnings: string[] = [];
  const today = ctx.now().toISOString().slice(0, 10);
  const from = req.from ?? today;
  const to = req.to ?? today;
  /** Refs this run can honestly claim to have checked over the whole window. */
  const covered = new Set<string>();
  const withCoverage = (): FetchResult => ({
    points,
    warnings,
    coverage: coverageFor(req.refs, { from, to }, points, (ref) => covered.has(ref)),
  });

  if (req.capability !== "series") {
    warnings.push(`bcb_sgs only supports 'series', got '${req.capability}'`);
    return withCoverage();
  }

  for (const ref of req.refs) {
    // One request per ref, so an abort costs at most the ref in flight; every
    // ref already finished keeps its points and its honest coverage entry.
    if (ctx.signal.aborted) {
      warnings.push("bcb_sgs: time budget exhausted before every ref was fetched");
      break;
    }
    const code = SGS_CODES[ref];
    if (code === undefined) {
      warnings.push(`bcb_sgs: no SGS code registered for '${ref}'`);
      continue;
    }
    if (ref === "br.ipca") {
      // Regression guard (MILESTONES.md decision 1): SGS 433 is a monthly
      // percentage change. Chaining it into a level is math, and packs never
      // supply math. br.ipca is served by br.ibge_sidra, which publishes the
      // número-índice directly.
      warnings.push(
        "bcb_sgs: br.ipca disabled until SGS 433 monthly variations are chained into a stable index level",
      );
      continue;
    }
    const url =
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados` +
      `?formato=json&dataInicial=${toBcbDate(from)}&dataFinal=${toBcbDate(to)}`;

    let res;
    try {
      res = await ctx.http.get(url, { headers: { accept: "application/json" } });
    } catch {
      // Transport failure or budget abort. Never name the URL (CLAUDE.md §logs).
      warnings.push(`bcb_sgs: request failed for '${ref}'`);
      continue;
    }
    if (res.status === 404) {
      // VERIFIED LIVE 2026-09-06: SGS answers a window containing no published
      // values with HTTP 404 and the business exception below — NOT with
      // `200 []`. That is "successfully checked, nothing published" (a weekend,
      // a holiday, or a day before the rate is out), so it must certify
      // coverage. Treating it as an error would stall the CDI/SELIC watermark
      // on every such run and re-request the same empty window forever.
      const body = await res.text();
      if (body.includes("Value(s) not found")) {
        covered.add(ref);
        continue;
      }
      warnings.push(`bcb_sgs: HTTP 404 for '${ref}'`);
      continue;
    }
    if (res.status !== 200) {
      warnings.push(`bcb_sgs: HTTP ${res.status} for '${ref}'`);
      continue;
    }
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) {
      warnings.push(`bcb_sgs: unexpected payload for '${ref}'`);
      continue;
    }
    let malformed = false;
    const fetched: FetchResult["points"] = [];
    for (const row of body as Array<{ data?: string; valor?: string }>) {
      if (typeof row.data !== "string" || typeof row.valor !== "string") {
        malformed = true;
        continue;
      }
      const value = percentagePointsToUnitRate(row.valor);
      if (value === null) {
        warnings.push(`bcb_sgs: invalid decimal value for '${ref}'`);
        malformed = true;
        continue;
      }
      fetched.push({ ref, date: fromBcbDate(row.data), value, currency: null });
    }
    points.push(...fetched);
    // SGS answers the exact window it was given, so a clean 200 covers it —
    // including a 200 with an empty array, which genuinely means "no
    // publication in this window" (a holiday run), not "not checked".
    if (!malformed) covered.add(ref);
  }
  return withCoverage();
}

export const bcbSgsSource: PriceSource = {
  id: "br.bcb_sgs",
  label: "BCB — SGS (Séries Temporais)",
  homepage: "https://dadosabertos.bcb.gov.br/",
  license: "public-domain",
  auth: "none",
  rateLimit: { requests: 10, perSeconds: 1 },
  capabilities: ["series"],
  fetch: fetchBcbSgs,
};
