import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type InstructorBelt = components['schemas']['InstructorBeltResponseDto'];

/** The signed-in instructor's own belts at this School (Decision 188). */
export function useMyBelts(schoolId: string | null) {
  return useQuery({
    queryKey: ['instructor-belts', schoolId, 'me'],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/instructor-belts/me', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

export function useDeclareMyBelt(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { disciplineId: string; rankId: string; stripeTierId: string }) =>
      unwrap(
        apiClient.PUT('/v1/schools/{schoolId}/instructor-belts/me/{disciplineId}', {
          params: { path: { schoolId, disciplineId: v.disciplineId } },
          body: { rankId: v.rankId, stripeTierId: v.stripeTierId },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instructor-belts', schoolId] }),
  });
}

/** The owner's view: every instructor's belts, and who hasn't chosen yet. */
export function useSchoolInstructorBelts(schoolId: string | null) {
  return useQuery({
    queryKey: ['instructor-belts', schoolId, 'all'],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/instructor-belts', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

export function useVerifyInstructorBelt(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { userId: string; disciplineId: string; rankId?: string; stripeTierId?: string }) =>
      unwrap(
        apiClient.POST('/v1/schools/{schoolId}/instructor-belts/{userId}/{disciplineId}/verify', {
          params: { path: { schoolId, userId: v.userId, disciplineId: v.disciplineId } },
          body: v.rankId && v.stripeTierId ? { rankId: v.rankId, stripeTierId: v.stripeTierId } : {},
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['instructor-belts', schoolId] }),
  });
}
