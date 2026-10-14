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

/**
 * Opaque cursor for keyset pagination ordered `(sortValue, id) DESC` — e.g. a
 * notification inbox or a "continue watching" list, where chronological order
 * matters and a bare id (random UUID) carries no useful ordering of its own
 * (NotificationsService.findAllForCaller's own "FOUND ON REVIEW" comment
 * explains why the plain `cursorPaginate` above is wrong for this shape).
 * Extracted here once a second caller needed the identical encode/decode
 * shape (Favorite/WatchHistory/Playlist/Comment, Decision 227/254) — each
 * caller still builds its own `where`/`orderBy` against its own Prisma
 * delegate, since that part genuinely differs per model.
 */
export function encodeDescCursor(sortValue: Date, id: string): string {
  return Buffer.from(JSON.stringify({ sortValue: sortValue.toISOString(), id })).toString('base64url');
}

export function decodeDescCursor(cursor: string): { sortValue: Date; id: string } {
  const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { sortValue: string; id: string };
  return { sortValue: new Date(parsed.sortValue), id: parsed.id };
}
