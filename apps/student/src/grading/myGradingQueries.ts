import { useQuery } from '@tanstack/react-query';
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
