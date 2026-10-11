import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type ClassResponse = components['schemas']['ClassResponseDto'];
export type CreateClassInput = components['schemas']['CreateClassDto'];
export type UpdateClassInput = components['schemas']['UpdateClassDto'];

export interface ClassesFilter {
  activities?: string;
  search?: string;
}

/** `filter`/`cursor` — additive, optional server-side filters + cursor pagination
 * (Classes page's Discipline filter + "Search classes" box + Prev/Next pager, now
 * wired to the real GET /schools/:schoolId/classes?activities=&search=&cursor=
 * query params instead of filtering an already-fully-fetched list client-side —
 * `ClassListResponseDto.nextCursor` was already real server-side, just never wired
 * to a pager here). Every caller that omits all three (MembershipPlansPage's own
 * "Scoped to Class" dropdown/label, which wants the School's whole Class list, not
 * one page of it) behaves exactly as before any of this existed. */
export function useClasses(schoolId: string | null, filter: ClassesFilter = {}, cursor?: string | null) {
  return useQuery({
    queryKey: ['classes', schoolId, filter.activities ?? null, filter.search ?? null, cursor ?? null],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/classes', {
          params: {
            path: { schoolId: schoolId! },
            query: { activities: filter.activities, search: filter.search, cursor: cursor ?? undefined },
          },
        }),
      ),
    enabled: !!schoolId,
    // FOUND ON REVIEW (Phase 18): MembershipPlansPage now also depends on
    // this hook (to populate the "Scoped to Class" dropdown/label) alongside
    // ClassesPage/TimetablePage — same reasoning as useBranches/useInstructors'
    // own staleTime comments (Phase 17/18): don't re-fetch a rarely-changing
    // reference list on every navigation between screens that share it.
    staleTime: 60_000,
  });
}

/** Single-Class fetch — for the Class detail page (Bookings/Waitlist admin),
 * which needs the Class's own title/details without re-fetching the whole
 * School's list. */
export function useClass(classId: string | null) {
  return useQuery({
    queryKey: ['class', classId],
    queryFn: () => unwrap(apiClient.GET('/v1/classes/{id}', { params: { path: { id: classId! } } })),
    enabled: !!classId,
  });
}

export function useCreateClass(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateClassInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/classes', { params: { path: { schoolId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['classes', schoolId] }),
  });
}

export function useUpdateClass(schoolId: string, classId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateClassInput) =>
      unwrap(apiClient.PATCH('/v1/classes/{id}', { params: { path: { id: classId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['classes', schoolId] }),
  });
}
