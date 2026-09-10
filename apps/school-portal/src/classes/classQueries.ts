import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type ClassResponse = components['schemas']['ClassResponseDto'];
export type CreateClassInput = components['schemas']['CreateClassDto'];
export type UpdateClassInput = components['schemas']['UpdateClassDto'];

/** No pagination in this UI yet — same established convention as
 * useBranches/useDisciplines/useInstructors (see their own header comments). */
export function useClasses(schoolId: string | null) {
  return useQuery({
    queryKey: ['classes', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/classes', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
    // FOUND ON REVIEW (Phase 18): MembershipPlansPage now also depends on
    // this hook (to populate the "Scoped to Class" dropdown/label) alongside
    // ClassesPage/TimetablePage — same reasoning as useBranches/useInstructors'
    // own staleTime comments (Phase 17/18): don't re-fetch a rarely-changing
    // reference list on every navigation between screens that share it.
    staleTime: 60_000,
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
