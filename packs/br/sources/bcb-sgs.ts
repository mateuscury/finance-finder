/**
 * Banco Central do Brasil — Sistema Gerenciador de Séries Temporais (SGS).
 * https://dadosabertos.bcb.gov.br/dataset/
 *
 * Endpoint shape:
 *   GET https://api.bcb.gov.br/dados/serie/bcdata.sgs.{code}/dados
 *       ?formato=json&dataInicial=dd/MM/yyyy&dataFinal=dd/MM/yyyy
 *   → [{ "data": "01/02/2024", "valor": "0.040168" }, ...]
 *
 * Values arrive as strings already; they are passed through untouched, which is
 * exactly what PACKS.md §7 rule 2 wants.
 */
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

export async function fetchBcbSgs(req: FetchRequest, ctx: FetchContext): Promise<FetchResult> {
  const points: FetchResult["points"] = [];
  const warnings: string[] = [];

  if (req.capability !== "series") {
    return { points, warnings: [`bcb_sgs only supports 'series', got '${req.capability}'`] };
  }

  const today = ctx.now().toISOString().slice(0, 10);
  const from = req.from ?? today;
  const to = req.to ?? today;

  for (const ref of req.refs) {
    const code = SGS_CODES[ref];
    if (code === undefined) {
      warnings.push(`bcb_sgs: no SGS code registered for '${ref}'`);
      continue;
    }
    const url =
      `https://api.bcb.gov.br/dados/serie/bcdata.sgs.${code}/dados` +
      `?formato=json&dataInicial=${toBcbDate(from)}&dataFinal=${toBcbDate(to)}`;
    const res = await ctx.http.get(url, { headers: { accept: "application/json" } });
    if (res.status !== 200) {
      warnings.push(`bcb_sgs: HTTP ${res.status} for '${ref}'`);
      continue;
    }
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) {
      warnings.push(`bcb_sgs: unexpected payload for '${ref}'`);
      continue;
    }
    for (const row of body as Array<{ data?: string; valor?: string }>) {
      if (typeof row.data !== "string" || typeof row.valor !== "string") continue;
      points.push({ ref, date: fromBcbDate(row.data), value: row.valor.trim(), currency: null });
    }
  }
  return { points, warnings };
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
