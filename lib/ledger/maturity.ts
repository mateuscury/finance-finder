/**
 * The Maturities convention (MILESTONES.md §4 decision 38; PACKS.md §5): an
 * instrument kind whose `metadataSchema` includes `maturity: IsoDate` is a
 * fixed-income holding. Detection reads the zod SHAPE — never a kind id —
 * so a pack's new kind appears on the ladder without a line of UI changing
 * (decision 42). The kernel never reads `maturity` (§2 decision 14).
 */
import { z } from "zod";
import type { InstrumentKind, IsoDate } from "@/packs/types";
import { IsoDateSchema } from "@/packs/schema";
import type { HoldingAsset } from "@/lib/calc/types";

const MaturityShape = z.object({ maturity: IsoDateSchema }).loose();

export function hasMaturity(kind: InstrumentKind): boolean {
  const schema = kind.metadataSchema;
  return schema instanceof z.ZodObject && "maturity" in schema.shape;
}

/** The asset's maturity date, or null when its metadata carries none that parses. */
export function maturityOf(asset: HoldingAsset): IsoDate | null {
  const parsed = MaturityShape.safeParse(asset.metadata);
  return parsed.success ? parsed.data.maturity : null;
}

/**
 * An accrual with no index — the contracted rate IS the return — is the
 * one kind whose value at maturity is known today (`valueHolding` at the
 * maturity date needs no future series). Everything indexed depends on
 * the index's path (decision 38).
 */
export function isPlainRateAccrual(kind: InstrumentKind): boolean {
  return kind.valuation.kind === "accrual" && kind.valuation.convention.index === undefined;
}
