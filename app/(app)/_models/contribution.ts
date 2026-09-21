/**
 * Contribution and attribution view models (SPEC §9 screen 4, §6; US-011
 * AC-011.2–3), pure over the kernel's results. A contribution is already
 * an asset's share of the simple return over the period — `Σ c_i` is the
 * return — so the rows carry it as is, largest magnitude first, with the
 * gain in base currency beside it. A null row names its reason and marks
 * the total partial. Attribution splits one holding's return into its
 * native and FX legs; a base-currency asset has `rFx` exactly zero, which
 * the screen states as a fact.
 */
import type { Attribution } from "@/lib/calc/attribution";
import type { ContributionResult } from "@/lib/calc/contribution";
import { toDecimalString } from "@/lib/calc/decimal";

export interface ContributionRow {
  assetId: string;
  identifier: string;
  name: string;
  /** Base currency; null with `reason`. */
  gain: string | null;
  /** The asset's share of the period's simple return; null with `reason`. */
  contribution: string | null;
  reason: string | null;
}

export interface ContributionModel {
  from: string;
  to: string;
  rows: ContributionRow[];
  /** The simple return: Σ of the defined contributions; null when the denominator is not positive. */
  total: string | null;
  denominator: string;
  partial: boolean;
  /** How many rows each reason made undefined. */
  reasons: Record<string, number>;
  droppedFlows: number;
}

export function contributionModel(input: {
  result: ContributionResult;
  identifiers: Record<string, string>;
  names: Record<string, string>;
  droppedFlows: number;
}): ContributionModel {
  const { result } = input;
  const reasons: Record<string, number> = {};
  const rows = result.assets
    .map((a) => {
      if (a.reason) reasons[a.reason] = (reasons[a.reason] ?? 0) + 1;
      return {
        assetId: a.assetId,
        identifier: input.identifiers[a.assetId] ?? a.assetId,
        name: input.names[a.assetId] ?? input.identifiers[a.assetId] ?? a.assetId,
        gain: a.gain === null ? null : a.gain.toString(),
        contribution: a.contribution === null ? null : toDecimalString(a.contribution),
        reason: a.reason ?? null,
        magnitude: a.contribution === null ? null : a.contribution.abs(),
      };
    })
    .sort((x, y) => {
      if (x.magnitude === null && y.magnitude === null) return x.identifier < y.identifier ? -1 : 1;
      if (x.magnitude === null) return 1;
      if (y.magnitude === null) return -1;
      return y.magnitude.comparedTo(x.magnitude) || (x.identifier < y.identifier ? -1 : 1);
    })
    .map(({ assetId, identifier, name, gain, contribution, reason }) => ({
      assetId,
      identifier,
      name,
      gain,
      contribution,
      reason,
    }));
  return {
    from: result.from,
    to: result.to,
    rows,
    total: result.total === null ? null : toDecimalString(result.total),
    denominator: toDecimalString(result.denominator),
    partial: result.partial || input.droppedFlows > 0,
    reasons,
    droppedFlows: input.droppedFlows,
  };
}

export interface AttributionModel {
  assetId: string;
  from: string;
  to: string;
  rNative: string | null;
  rFx: string | null;
  rBase: string | null;
  reason: string | null;
  /** `rFx` is exactly zero: the asset is quoted in the base currency. */
  isBaseCurrency: boolean;
  /** Sub-period boundaries the kernel chained (the first may be later than `from`). */
  boundaries: readonly string[];
}

export function attributionModel(a: Attribution): AttributionModel {
  return {
    assetId: a.assetId,
    from: a.from,
    to: a.to,
    rNative: a.rNative === null ? null : toDecimalString(a.rNative),
    rFx: a.rFx === null ? null : toDecimalString(a.rFx),
    rBase: a.rBase === null ? null : toDecimalString(a.rBase),
    reason: a.reason ?? null,
    isBaseCurrency: a.rFx !== null && a.rFx.isZero(),
    boundaries: a.boundaries,
  };
}
