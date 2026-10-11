import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type ClassResponse = components['schemas']['ClassResponseDto'];
export type CreateClassInput = components['schemas']['CreateClassDto'];
export type UpdateClassInput = components['schemas']['UpdateClassDto'];

/** `cursor` is optional and defaults to the first page — TimetablePage and
 * MembershipPlansPage (see the Phase 18 note below) both call this with no
 * cursor and need the same first-page behavior they already get today;
 * only ClassesPage's own pager (v1.2 backend backlog, Decision 242) passes
 * one. Still no `limit`/filter params wired into this shared hook — those
 * stay ClassesPage-only, passed straight to the fetch call below rather
 * than threaded through this hook's own signature, so the two other
 * unfiltered callers are unaffected. */
export function useClasses(schoolId: string | null, cursor?: string) {
  return useQuery({
    queryKey: ['classes', schoolId, cursor],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/classes', {
          params: { path: { schoolId: schoolId! }, query: cursor ? { cursor } : undefined },
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
