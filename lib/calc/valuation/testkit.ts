/**
 * Fixtures shared by the valuation tests. Test-only: nothing here is exported
 * from the kernel surface.
 */
import { z } from "zod";
import type { InstrumentKind, MarketCalendar, SeriesDescriptor, ValuationStrategy } from "@/packs/types";
import { isBusinessDay } from "../calendar";
import { KernelDecimal, type KDecimal } from "../decimal";
import type { Money } from "../money";
import { addDays } from "../dates";
import type { Lot } from "../positions";
import type { HoldingAsset, SeriesObservation } from "../types";

export const sevenDay: MarketCalendar = { timezone: "UTC", weekend: [], holidays: () => [], settlement: "T+0" };

export const CDI: SeriesDescriptor = {
  id: "br.cdi",
  label: "CDI",
  kind: { kind: "rate_daily", dayCount: "BUS/252" },
  sourceId: "br.bcb_sgs",
  roles: ["accrual_index"],
};
export const IPCA: SeriesDescriptor = {
  id: "br.ipca",
  label: "IPCA",
  kind: { kind: "inflation_index", interpolation: "linear_daily" },
  sourceId: "br.ibge_sidra",
  roles: ["accrual_index", "deflator"],
};
export const IBOV: SeriesDescriptor = {
  id: "br.ibovespa",
  label: "Ibovespa",
  kind: { kind: "index_level" },
  sourceId: "br.brapi",
  roles: ["benchmark"],
};
export const CURVE: SeriesDescriptor = {
  id: "zz.curve",
  label: "Synthetic curve",
  kind: { kind: "yield_curve", tenors: [30, 3650] },
  sourceId: "zz.test",
  roles: ["discount_curve"],
};
export const USDBRL: SeriesDescriptor = {
  id: "global.usdbrl",
  label: "USD/BRL",
  kind: { kind: "fx_rate", base: "USD", quote: "BRL" },
  sourceId: "global.bcb_ptax",
  roles: ["fx"],
};

export function kind(id: string, valuation: ValuationStrategy, quoteCurrency = "BRL"): InstrumentKind {
  return { id, label: id, valuation, metadataSchema: z.object({}).passthrough(), identifier: "custom", quoteCurrency };
}

export function asset(
  id: string,
  instrumentKind: InstrumentKind,
  metadata: unknown = {},
  nativeCurrency = "BRL",
  packId = "br",
): HoldingAsset {
  return { id, packId, instrumentKind, identifier: id, nativeCurrency, metadata };
}

export function lot(openedOn: string, quantity: string, unitPrice: string, currency = "BRL"): Lot {
  return {
    openedOn,
    quantity: new KernelDecimal(quantity),
    unitPrice: new KernelDecimal(unitPrice),
    currency,
    transactionId: `t-${openedOn}`,
  };
}

export const pt = (seriesId: string, date: string, value: string, tenorDays = 0): SeriesObservation => ({
  seriesId,
  date,
  value,
  tenorDays,
});

/** One `br.cdi` point per business day of [start, end] under `calendar`. */
export function constantCdi(calendar: MarketCalendar, start: string, end: string, value: string): SeriesObservation[] {
  const out: SeriesObservation[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) if (isBusinessDay(calendar, d)) out.push(pt("br.cdi", d, value));
  return out;
}

export function near(actual: KDecimal, expected: KDecimal | string, tolerance = "1e-30"): boolean {
  return actual.minus(expected).abs().lte(tolerance);
}

/** "BRL 1250" — currency and canonical amount in one assertion. */
export const money = (m: Money): string => `${m.currency} ${m.toString()}`;
