import { useInfiniteQuery } from '@tanstack/react-query';

/** Every list endpoint uses the same cursor-based pagination shape (Decision
 * 22/70): each page carries `items` plus an optional `nextCursor`. This collapses
 * the identical useInfiniteQuery wiring that academyQueries/bookingQueries/
 * membershipQueries/notificationQueries were each repeating — the endpoint-specific
 * `apiClient.GET`/`unwrap` call stays at the call site (as `fetchPage`) so each
 * hook's own request/response typing is still inferred normally from the generated
 * OpenAPI client, rather than forcing every list endpoint through one generic path
 * union. */
export function usePaginatedQuery<TPage extends { nextCursor?: string | null }>(
  queryKey: readonly unknown[],
  fetchPage: (cursor: string | undefined) => Promise<TPage>,
  options?: { enabled?: boolean },
) {
  return useInfiniteQuery({
    queryKey,
    queryFn: ({ pageParam }: { pageParam?: string }) => fetchPage(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: options?.enabled,
  });
}
