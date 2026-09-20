/**
 * Read an entire PostgREST collection page by page.
 *
 * PostgREST caps a response at `api.max_rows` (1,000 by default,
 * supabase/config.toml) and treating that cap as the total silently drops
 * every row past it. Every collection read in the project goes through this
 * helper (docs/milestone-3-plan.md "Reads"); the builder passed in must have
 * every filter applied BEFORE `.range()`, because range paginates the result
 * of the filters that precede it.
 */

export const PAGE_SIZE = 500;

export type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function readAll<T>(
  // PostgREST builders are thenable but are not Promises, so the parameter is
  // typed as PromiseLike rather than Promise.
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  pageSize = PAGE_SIZE,
): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await fetchPage(offset, offset + pageSize - 1);
    if (error) throw new Error(`paginate: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < pageSize) return out;
  }
}
