import { z } from "zod";
import type { InstrumentKind } from "../types";
import { DecimalStringSchema, IsoDateSchema } from "../schema";

/**
 * Instrument kinds the BR pack maps onto kernel valuation strategies
 * (PACKS.md §4.1, §5, §13). No math lives here — only the mapping.
 */

/**
 * Tesouro Direto is valued from the published unit price (`nav_unit_price`),
 * so this metadata is about IDENTITY and DISPLAY, not discounting
 * (MILESTONES.md decision 2). The kernel curve shape is deliberately not
 * extended: coupon and indexation fields are what a `curve_mark_to_market`
 * strategy would need, and this instrument no longer uses one.
 */
const TesouroDiretoMetadata = z.object({
  /** Official bond name exactly as Tesouro publishes it: "Tesouro IPCA+ com Juros Semestrais". */
  titulo: z.string().min(1),
  /** Second half of the canonical identifier; the file has no ISIN. */
  maturity: IsoDateSchema,
  /**
   * "Taxa Compra Manha" on the purchase date, as a unit rate. DISPLAY ONLY.
   * Valuing a holding by accruing at this rate ("marcação na curva") produces a
   * different number from market value; if ever wanted it is a kernel
   * `accrual` feature, never a silent substitution here.
   */
  purchaseRate: DecimalStringSchema.optional(),
});

/**
 * "110% do CDI", "IPCA + 6%", or a plain prefixado rate — all via
 * AccrualConvention. `maturity` is display and Maturities-screen data only:
 * the kernel accrues until a sell closes the lot (MILESTONES.md decision 14).
 */
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
    valuation: { kind: "nav_unit_price", sourceId: "br.tesouro_transparente" },
    metadataSchema: TesouroDiretoMetadata,
    // The published CSV identifies a bond by (Tipo Titulo, Data Vencimento) and
    // contains no ISIN. `tesouroCanonicalId` in sources/tesouro-transparente.ts
    // builds the canonical `td:<slug>:<YYYY-MM-DD>` form.
    identifier: "custom",
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
    // Plain prefixado: the contracted rate IS the effective annual rate
    // ("12% a.a."), recognised daily on BUS/252 (MILESTONES.md decisions 5, 9).
    id: "br.cdb_prefixado",
    label: "CDB prefixado",
    valuation: {
      kind: "accrual",
      convention: { dayCount: "BUS/252", compounding: "daily" },
    },
    metadataSchema: PrivateCreditMetadata,
    identifier: "custom",
    quoteCurrency: "BRL",
  },
  {
    // "IPCA + 6%": the level ratio of the índice times the spread's own factor.
    id: "br.cdb_ipca",
    label: "CDB IPCA+",
    valuation: {
      kind: "accrual",
      convention: {
        dayCount: "BUS/252",
        compounding: "daily",
        index: { mode: "index_plus_spread", seriesId: "br.ipca" },
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
