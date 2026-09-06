import { z } from "zod";
import type { InstrumentKind } from "../types";
import { CurveMetadataBaseSchema, DecimalStringSchema, IsoDateSchema } from "../schema";

/**
 * Instrument kinds the BR pack maps onto kernel valuation strategies
 * (PACKS.md §4.1, §5, §13). No math lives here — only the mapping.
 */

const TesouroDiretoMetadata = CurveMetadataBaseSchema.extend({
  /** Official bond name, e.g. "Tesouro IPCA+ 2035". */
  titulo: z.string().min(1),
});

/** "110% do CDI", "IPCA + 6%", or a plain prefixado rate — all via AccrualConvention. */
const PrivateCreditMetadata = z.object({
  issuer: z.string().min(1),
  /** Annual rate as a decimal string: "0.12" for 12% a.a., or the % of index: "1.10" for 110% do CDI. */
  rate: DecimalStringSchema,
  maturity: IsoDateSchema,
  /** Optional grace period before liquidity; informational for v1. */
  liquidityFrom: IsoDateSchema.optional(),
});

const FiiMetadata = z.object({
  /** CVM-registered fund name. */
  fundName: z.string().min(1),
  segment: z.string().optional(),
});

export const brInstruments: InstrumentKind[] = [
  {
    id: "br.tesouro_direto",
    label: "Tesouro Direto",
    valuation: { kind: "curve_mark_to_market", seriesId: "br.td_curve" },
    metadataSchema: TesouroDiretoMetadata,
    identifier: "isin",
    quoteCurrency: "BRL",
  },
  {
    id: "br.cdb",
    label: "CDB",
    valuation: {
      kind: "accrual",
      convention: {
        dayCount: "BUS/252",
        compounding: "daily",
        index: { mode: "percent_of_index", seriesId: "br.cdi" },
      },
    },
    metadataSchema: PrivateCreditMetadata,
    identifier: "custom",
    quoteCurrency: "BRL",
  },
  {
    id: "br.lci_lca",
    label: "LCI / LCA",
    valuation: {
      kind: "accrual",
      convention: {
        dayCount: "BUS/252",
        compounding: "daily",
        index: { mode: "percent_of_index", seriesId: "br.cdi" },
      },
    },
    metadataSchema: PrivateCreditMetadata,
    identifier: "custom",
    quoteCurrency: "BRL",
  },
  {
    id: "br.fii",
    label: "Fundo Imobiliário (FII)",
    valuation: { kind: "market_price", sourceId: "br.brapi" },
    metadataSchema: FiiMetadata,
    identifier: "ticker",
    quoteCurrency: "BRL",
  },
];
