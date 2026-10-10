import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type StudentEligibility = components['schemas']['StudentEligibilityResponseDto'];
export type Eligibility = components['schemas']['EligibilityResponseDto'];
export type PromotionEvent = components['schemas']['PromotionEventResponseDto'];
export type GradingActionInput = components['schemas']['GradingActionDto'];
export type DowngradeInput = components['schemas']['DowngradeActionDto'];

/** One student's rank in every style at this School, with readiness for their
 * next rung from the grading engine (Decisions 127, 136, 149, 171). */
export function useStudentEligibility(studentId: string | null, schoolId: string | null) {
  return useQuery({
    queryKey: ['student-grading', studentId, 'eligibility', schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/students/{id}/eligibility', { params: { path: { id: studentId! }, query: { schoolId: schoolId! } } })),
    enabled: !!studentId && !!schoolId,
  });
}

/** The student's rank history at this School, newest first (Decisions 129, 166).
 * The panel shows one page of 100 entries; that covers a student's whole
 * history in practice, so there's no "load more" yet. */
export function useRankHistory(studentId: string | null, schoolId: string | null, includeVoided: boolean) {
  return useQuery({
    queryKey: ['student-grading', studentId, 'history', schoolId, includeVoided],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/students/{id}/rank-history', {
          params: { path: { id: studentId! }, query: { schoolId: schoolId!, limit: 100, ...(includeVoided ? { includeVoided: true } : {}) } },
        }),
      ),
    enabled: !!studentId && !!schoolId,
  });
}

/** Every grading write refreshes the whole panel: rank, readiness and history. */
function useGradingMutation<TVars>(studentId: string, fn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['student-grading', studentId] }),
  });
}

export function usePromote(studentId: string, disciplineId: string) {
  return useGradingMutation(studentId, (body: GradingActionInput) =>
    unwrap(apiClient.POST('/v1/students/{id}/ranks/{disciplineId}/promote', { params: { path: { id: studentId, disciplineId } }, body })),
  );
}

export function useStripeAward(studentId: string, disciplineId: string) {
  return useGradingMutation(studentId, (body: GradingActionInput) =>
    unwrap(apiClient.POST('/v1/students/{id}/ranks/{disciplineId}/stripe-award', { params: { path: { id: studentId, disciplineId } }, body })),
  );
}

export function useDowngrade(studentId: string, disciplineId: string) {
  return useGradingMutation(studentId, (body: DowngradeInput) =>
    unwrap(apiClient.POST('/v1/students/{id}/ranks/{disciplineId}/downgrade', { params: { path: { id: studentId, disciplineId } }, body })),
  );
}

export function useEditRankDate(studentId: string, disciplineId: string) {
  return useGradingMutation(studentId, (body: { date: string; note?: string }) =>
    unwrap(apiClient.PATCH('/v1/students/{id}/ranks/{disciplineId}/rank-date', { params: { path: { id: studentId, disciplineId } }, body })),
  );
}

export function useVerifyRank(studentId: string, disciplineId: string) {
  return useGradingMutation(studentId, (body: { rankId?: string; stripeTierId?: string; note?: string }) =>
    unwrap(apiClient.POST('/v1/students/{id}/ranks/{disciplineId}/verify', { params: { path: { id: studentId, disciplineId } }, body })),
  );
}

/** Cycles a skill: Not started → Learning → Signed off → Not started. */
export function useCycleSkill(studentId: string) {
  return useGradingMutation(studentId, (skillId: string) =>
    unwrap(apiClient.PATCH('/v1/students/{id}/skills/{skillId}', { params: { path: { id: studentId, skillId } } })),
  );
}

export function useVoidEntry(studentId: string, schoolId: string) {
  return useGradingMutation(studentId, ({ eventId, reason }: { eventId: string; reason: string }) =>
    unwrap(
      apiClient.POST('/v1/students/{id}/rank-history/{eventId}/void', {
        params: { path: { id: studentId, eventId }, query: { schoolId } },
        body: { reason },
      }),
    ),
  );
}
