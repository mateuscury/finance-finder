/**
 * The ONE documented place a decimal string becomes a JS number
 * (docs/milestone-4-plan.md "The number boundary"; MILESTONES.md §4
 * decision 35): a chart coordinate. Never for a label, a total or anything
 * a person reads — those stay decimal strings through `lib/format`. Lint
 * bans `Number(` everywhere else under `app/` and `lib/`, and
 * `coordinate.test.ts` proves this file is the only one that calls it.
 */
export function toCoordinate(value: string): number {
  return Number(value);
}
