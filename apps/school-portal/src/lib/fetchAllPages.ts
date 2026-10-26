/**
 * Reads every page of a cursor-paginated list (`items` + `nextCursor`), for
 * screens that must show all of it at once: a roll call that misses the 21st
 * student is wrong, not just incomplete (Classes review C2). Pages of 100, the
 * API's maximum. Meant for lists that stay small (a Class's bookings), not for
 * a School's whole history.
 */
export async function fetchAllPages<T>(
  fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor?: string | null }>,
): Promise<T[]> {
  const all: T[] = [];
  let cursor: string | undefined;
  for (;;) {
    const page = await fetchPage(cursor);
    all.push(...page.items);
    if (!page.nextCursor) return all;
    cursor = page.nextCursor;
  }
}

/** The page size callers pass alongside `fetchAllPages` (the API's maximum). */
export const ALL_PAGES_LIMIT = 100;
