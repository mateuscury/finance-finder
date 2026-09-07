/**
 * Pack activation (plan §3.1).
 *
 * Two layers, deliberately separate:
 *  - `resolveActivation` is PURE. Given the registry and a set of enabled ids
 *    it resolves dependencies transitively, drops unknown ids with a warning
 *    and refuses cycles. It is where every rule lives and where every rule is
 *    tested, with no database in sight.
 *  - `readEnabledPackIds` is the only part that touches the store, and it
 *    exists mainly to paginate.
 *
 * Why transitive resolution matters: a user who enables only `br` still needs
 * `global` ingested, because `br` values BDR-style exposure and any USD figure
 * through `global.usdbrl` (PTAX). Forgetting the dependency would leave FX
 * silently stale rather than visibly broken.
 */
import type { MarketPack } from "@/packs/types";

export interface ActivationResult {
  /** Activated packs, in registry order for stable downstream iteration. */
  packs: MarketPack[];
  /** Ids that were requested but are not registered. */
  unknown: string[];
  warnings: string[];
}

export function resolveActivation(registry: readonly MarketPack[], enabled: readonly string[]): ActivationResult {
  const byId = new Map(registry.map((p) => [p.id, p]));
  const warnings: string[] = [];
  const unknown: string[] = [];
  const activated = new Set<string>();

  // Duplicates are harmless input, not an error: several users may enable the
  // same pack, and the union is what matters.
  const requested = [...new Set(enabled)];

  const visit = (id: string, chain: string[]): void => {
    const pack = byId.get(id);
    if (!pack) {
      if (!unknown.includes(id)) {
        unknown.push(id);
        warnings.push(`activation: ignoring unknown pack '${id}'`);
      }
      return;
    }
    if (chain.includes(id)) {
      // A cycle is a manifest bug. Refusing loudly beats looping, and beats
      // silently activating half a graph.
      throw new Error(`activation: pack dependency cycle: ${[...chain, id].join(" -> ")}`);
    }
    if (activated.has(id)) return;
    // Depth-first BEFORE marking activated, so a cycle is detected on the way
    // down rather than masked by the memo.
    for (const dependencyId of pack.dependencies ?? []) visit(dependencyId, [...chain, id]);
    activated.add(id);
  };

  for (const id of requested) visit(id, []);

  return {
    packs: registry.filter((p) => activated.has(p.id)),
    unknown,
    warnings,
  };
}

/** The slice of the store this module needs; keeps Supabase out of the tests. */
export interface EnabledPacksStore {
  /**
   * One page of `user_settings.enabled_packs`. Implementations MUST honour
   * `offset`/`limit`: PostgREST caps a collection at `api.max_rows` (1,000 by
   * default), and treating that cap as a total count silently ignores every
   * user past it.
   */
  listEnabledPacks(offset: number, limit: number): Promise<string[][]>;
}

export const ENABLED_PACKS_PAGE_SIZE = 500;

/**
 * Union of every user's `enabled_packs`, read page by page.
 *
 * Ingestion is global: market data is not user-scoped (`series_points` has no
 * `user_id`), so one run covers the union of what all users enabled.
 */
export async function readEnabledPackIds(
  store: EnabledPacksStore,
  pageSize = ENABLED_PACKS_PAGE_SIZE,
): Promise<string[]> {
  const union = new Set<string>();
  for (let offset = 0; ; offset += pageSize) {
    const page = await store.listEnabledPacks(offset, pageSize);
    for (const row of page) for (const id of row) union.add(id);
    // A short page is the last page; a full page means there may be more.
    if (page.length < pageSize) break;
  }
  return [...union];
}

export async function activateFromStore(
  registry: readonly MarketPack[],
  store: EnabledPacksStore,
  pageSize = ENABLED_PACKS_PAGE_SIZE,
): Promise<ActivationResult> {
  return resolveActivation(registry, await readEnabledPackIds(store, pageSize));
}
