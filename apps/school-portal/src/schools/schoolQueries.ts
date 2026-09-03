import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type SchoolResponse = components['schemas']['SchoolResponseDto'];
export type CreateSchoolInput = components['schemas']['CreateSchoolDto'];
export type UpdateSchoolInput = components['schemas']['UpdateSchoolDto'];

export function useSchool(schoolId: string | null) {
  return useQuery({
    queryKey: ['school', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{id}', { params: { path: { id: schoolId! } } })),
    enabled: !!schoolId,
  });
}

export function useCreateSchool() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSchoolInput) => unwrap(apiClient.POST('/v1/schools', { body })),
    onSuccess: () => {
      // The new grant only takes effect on this token at next login (Spec §8.3 — JWTs
      // are only rebuilt from the live RoleGrant set at login/refresh time), so the
      // caller re-logs in after creating their first School; this just invalidates any
      // cached school queries for when they do.
      queryClient.invalidateQueries({ queryKey: ['school'] });
    },
  });
}

export function useUpdateSchool(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSchoolInput) =>
      unwrap(apiClient.PATCH('/v1/schools/{id}', { params: { path: { id: schoolId } }, body })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['school', schoolId] });
    },
  });
}
