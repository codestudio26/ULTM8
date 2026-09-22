import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { usePaginatedQuery } from '../lib/usePaginatedQuery';

/** Every list endpoint uses cursor-based pagination (?cursor=&limit=), never
 * offset/page — Decision 22/70, platform-wide convention. */
export function useAcademies() {
  return usePaginatedQuery(['academies'], (cursor) =>
    unwrap(apiClient.GET('/v1/academies', { params: { query: { cursor } } })),
  );
}

export function useAcademy(academyId: string | null) {
  return useQuery({
    queryKey: ['academy', academyId],
    queryFn: () => unwrap(apiClient.GET('/v1/academies/{id}', { params: { path: { id: academyId! } } })),
    enabled: !!academyId,
  });
}

export function useAcademyTimetable(academyId: string | null) {
  return usePaginatedQuery(
    ['academy-timetable', academyId],
    (cursor) =>
      unwrap(
        apiClient.GET('/v1/academies/{id}/timetable', {
          params: { path: { id: academyId! }, query: { cursor } },
        }),
      ),
    { enabled: !!academyId },
  );
}
