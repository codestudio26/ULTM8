import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type GradingStyle = components['schemas']['StudentGradingStyleDto'];
export type GradingRung = components['schemas']['GradingLadderRungDto'];
export type GradingSkill = components['schemas']['GradingSkillDto'];
export type HistoryEvent = components['schemas']['PromotionEventResponseDto'];

/** A student's grading at every School they're a student at, read-only, for
 * the student themselves or a guardian of theirs (Decisions 132, 142, 161).
 * One call: a guardian can't read the School's styles, belts or skills
 * directly (they hold no role there), so the API sends the names with it. */
export function useGradingOverview(studentId: string | null) {
  return useQuery({
    queryKey: ['grading-overview', studentId],
    queryFn: () => unwrap(apiClient.GET('/v1/students/{id}/grading', { params: { path: { id: studentId! } } })),
    enabled: !!studentId,
  });
}

/** Rank history at one School, newest first (Decision 155). Voided entries
 * and hidden notes are never sent to the student or guardian (Decisions 129, 192). */
export function useMyRankHistory(studentId: string | null, schoolId: string | null) {
  return useQuery({
    queryKey: ['my-rank-history', studentId, schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/students/{id}/rank-history', { params: { path: { id: studentId! }, query: { schoolId: schoolId!, limit: 100 } } })),
    enabled: !!studentId && !!schoolId,
  });
}

export type FeeRequest = components['schemas']['PromotionFeeRequestResponseDto'];

/** The student's promotion fee requests at every School, newest first, for
 * the student or their Guardian (Decisions 287, 300). */
export function feeRequestsQuery(studentId: string | null) {
  return {
    queryKey: ['my-fee-requests', studentId],
    queryFn: () => unwrap(apiClient.GET('/v1/students/{id}/promotion-fee-requests', { params: { path: { id: studentId! } } })),
    enabled: !!studentId,
  };
}

export function useMyFeeRequests(studentId: string | null) {
  return useQuery(feeRequestsQuery(studentId));
}

/** A fee waiting for an answer: not yet accepted or declined, and not a
 * promotion left "to decide" by a coach (Decision 307). */
export function isFeeToAnswer(r: FeeRequest): boolean {
  return r.status === 'PENDING' && !r.toDecide;
}

/** Accept or decline a fee (the student, or the Guardian for a child). The
 * School is told either way; accepting never charges by itself. */
export function useAnswerFee(studentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, answer }: { id: string; answer: 'accept' | 'decline' }) =>
      answer === 'accept'
        ? unwrap(apiClient.POST('/v1/promotion-fee-requests/{id}/accept', { params: { path: { id } } }))
        : unwrap(apiClient.POST('/v1/promotion-fee-requests/{id}/decline', { params: { path: { id } } })),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['my-fee-requests', studentId] }),
        queryClient.invalidateQueries({ queryKey: ['grading-overview', studentId] }),
      ]),
  });
}
