export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export function resolveLimit(requested?: number): number {
  if (!requested) return DEFAULT_LIMIT;
  return Math.min(Math.max(requested, 1), MAX_LIMIT);
}

/**
 * Id-ordered cursor pagination (Decision 22 — cursor-based, never offset/page). Fetches
 * one extra row past `limit` to detect whether a next page exists, matching the
 * standard "over-fetch by one" cursor technique; the response envelope shape
 * (`items`/`nextCursor`) is a Developer-level choice, not itself spec-confirmed (see
 * PaginationQueryDto).
 *
 * `findMany` is the caller's own tenant-scoped Prisma delegate call (already run inside
 * withTenantContext) — this helper only shapes the cursor/limit/nextCursor mechanics
 * around it, it never bypasses RLS itself.
 */
export async function cursorPaginate<T extends { id: string }>(
  findMany: (args: { cursor?: { id: string }; skip?: number; take: number; orderBy: { id: 'asc' } }) => Promise<T[]>,
  cursor: string | undefined,
  limit: number | undefined,
): Promise<CursorPage<T>> {
  const take = resolveLimit(limit);
  const rows = await findMany({
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    take: take + 1,
    orderBy: { id: 'asc' },
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1].id : null };
}
