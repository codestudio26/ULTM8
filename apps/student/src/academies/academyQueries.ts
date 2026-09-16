import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';

/** Every list endpoint uses cursor-based pagination (?cursor=&limit=), never
 * offset/page — Decision 22/70, platform-wide convention. */
export function useAcademies() {
  return useInfiniteQuery({
    queryKey: ['academies'],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      unwrap(apiClient.GET('/v1/academies', { params: { query: { cursor: pageParam } } })),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });
}

export function useAcademy(academyId: string | null) {
  return useQuery({
    queryKey: ['academy', academyId],
    queryFn: () => unwrap(apiClient.GET('/v1/academies/{id}', { params: { path: { id: academyId! } } })),
    enabled: !!academyId,
  });
}

export function useAcademyTimetable(academyId: string | null) {
  return useInfiniteQuery({
    queryKey: ['academy-timetable', academyId],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      unwrap(
        apiClient.GET('/v1/academies/{id}/timetable', {
          params: { path: { id: academyId! }, query: { cursor: pageParam } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!academyId,
  });
}
