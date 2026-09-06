import type { SeriesDescriptor } from "../types";

/**
 * Series the BR pack registers (PACKS.md §6, §13).
 *
 * SPEC.md lists eight benchmarks; only those PACKS.md names explicitly, plus
 * the two index levels every Brazilian portfolio compares against, are declared
 * here. Reconcile the remaining benchmarks against SPEC.md when it lands.
 *
 * Series ids double as the `ref` an adapter returns, so sources map them to
 * their upstream codes (see sources/bcb-sgs.ts).
 */
export const brSeries: SeriesDescriptor[] = [
  {
    id: "br.cdi",
    label: "CDI",
    kind: { kind: "rate_daily", dayCount: "BUS/252" },
    sourceId: "br.bcb_sgs",
    roles: ["benchmark", "accrual_index"],
  },
  {
    id: "br.selic",
    label: "SELIC",
    kind: { kind: "rate_daily", dayCount: "BUS/252" },
    sourceId: "br.bcb_sgs",
    roles: ["benchmark", "accrual_index"],
  },
  {
    id: "br.ipca",
    label: "IPCA",
    kind: { kind: "inflation_index", interpolation: "linear_daily" },
    sourceId: "br.bcb_sgs",
    roles: ["benchmark", "deflator", "accrual_index"],
  },
  {
    id: "br.ibovespa",
    label: "Ibovespa",
    kind: { kind: "index_level" },
    sourceId: "br.brapi",
    roles: ["benchmark"],
  },
  {
    id: "br.ifix",
    label: "IFIX",
    kind: { kind: "index_level" },
    sourceId: "br.brapi",
    roles: ["benchmark"],
  },
  {
    id: "br.td_curve",
    label: "Tesouro Direto — taxas de referência",
    // Tenors in business days (BUS/252), matching how Brazilian curves are quoted.
    kind: { kind: "yield_curve", tenors: [21, 63, 126, 252, 504, 756, 1260, 2520, 5040, 7560] },
    sourceId: "br.tesouro_transparente",
    roles: ["discount_curve"],
  },
];
