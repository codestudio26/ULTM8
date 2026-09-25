import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type InstructorResponse = components['schemas']['InstructorResponseDto'];
export type CreateInstructorInput = components['schemas']['CreateInstructorDto'];
export type UpdateInstructorInput = components['schemas']['UpdateInstructorDto'];
export type EligibleInstructorUser = components['schemas']['EligibleInstructorUserDto'];

/** No pagination in this UI yet — same established convention as
 * useBranches/useDisciplines (see their own header comments). */
export function useInstructors(schoolId: string | null) {
  return useQuery({
    queryKey: ['instructors', schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/instructors', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
    // FOUND ON REVIEW (Phase 17): Classes/Timetable both call this same hook
    // to populate an Instructor dropdown — see useBranches' own comment for
    // the identical reasoning (navigating between these screens shouldn't
    // re-fetch reference data that rarely changes; a real create/update still
    // invalidates this query key directly).
    staleTime: 60_000,
  });
}

/** Candidate pool for InstructorFormModal's picker (Decision 114) — Users already
 * holding an active INSTRUCTOR RoleGrant at this School. Unpaginated, matching the
 * backend endpoint. */
export function useEligibleInstructorUsers(schoolId: string | null) {
  return useQuery({
    queryKey: ['instructors', 'eligible-users', schoolId],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/instructors/eligible-users', {
          params: { path: { schoolId: schoolId! } },
        }),
      ),
    enabled: !!schoolId,
  });
}

export function useCreateInstructor(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateInstructorInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/instructors', { params: { path: { schoolId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instructors', schoolId] }),
  });
}

export function useUpdateInstructor(schoolId: string, instructorId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateInstructorInput) =>
      unwrap(apiClient.PATCH('/v1/instructors/{id}', { params: { path: { id: instructorId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instructors', schoolId] }),
  });
}
