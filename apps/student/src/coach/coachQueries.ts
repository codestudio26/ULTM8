import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type Eligibility = components['schemas']['EligibilityResponseDto'];
export type StudentEligibility = components['schemas']['StudentEligibilityResponseDto'];
export type GradingBoardItem = components['schemas']['GradingBoardItemDto'];
export type BoardColumn = 'JUST_STARTING' | 'GETTING_THERE' | 'READY_TO_GRADE';
export type PromotionEvent = components['schemas']['PromotionEventResponseDto'];
export type GradingActionInput = components['schemas']['GradingActionDto'];
export type DowngradeInput = components['schemas']['DowngradeActionDto'];
export type RankResponse = components['schemas']['RankResponseDto'];
export type SkillResponse = components['schemas']['SkillResponseDto'];
export type DisciplineResponse = components['schemas']['DisciplineResponseDto'];

export type GradingToggle =
  | 'canPromote'
  | 'canDowngrade'
  | 'canSignOffSkills'
  | 'canAdjustProgress'
  | 'canVerifyRanks'
  | 'canVoidHistory'
  | 'canChangeBoardThresholds';

/** What the caller may do in each style (Decisions 181, 184): a coach only
 * their own styles and toggles. The API enforces it either way; this only
 * hides what they can't use. Same rules as the School Portal's useMyGrading. */
export function useMyGrading(schoolId: string | null) {
  const query = useQuery({
    queryKey: ['grading-permissions', 'me', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/grading-permissions/me', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
  const data = query.data;
  const can = (disciplineId: string | null | undefined, toggle: GradingToggle) => {
    if (!data || !disciplineId) return false;
    if (data.isOwner) return true;
    const row = data.items.find((p) => p.disciplineId === disciplineId);
    return !!row && row[toggle];
  };
  const mayGradeStyle = (disciplineId: string) => !!data && (data.isOwner || data.items.some((p) => p.disciplineId === disciplineId));
  return { isLoading: query.isLoading, error: query.error, can, mayGradeStyle };
}

/** The Grading Board for one style: students of the coach's own branches with
 * a next rank, highest progress first (Decisions 136, 168). */
export function useGradingBoard(schoolId: string | null, disciplineId: string | null, activeOnly: boolean) {
  return useQuery({
    queryKey: ['grading-board', schoolId, disciplineId, activeOnly],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/grading-board', {
          params: { path: { schoolId: schoolId! }, query: { disciplineId: disciplineId!, ...(activeOnly ? { activeOnly: true } : {}) } },
        }),
      ),
    enabled: !!schoolId && !!disciplineId,
  });
}

/** One student's rank in every style at the School, with readiness for the next one. */
export function useStudentEligibility(studentId: string | null, schoolId: string | null) {
  return useQuery({
    queryKey: ['student-grading', studentId, 'eligibility', schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/students/{id}/eligibility', { params: { path: { id: studentId! }, query: { schoolId: schoolId! } } })),
    enabled: !!studentId && !!schoolId,
  });
}

/** The student's rank history at this School, newest first (Decisions 129, 166, 185). */
export function useRankHistory(studentId: string | null, schoolId: string | null) {
  return useQuery({
    queryKey: ['student-grading', studentId, 'history', schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/students/{id}/rank-history', { params: { path: { id: studentId! }, query: { schoolId: schoolId!, limit: 50 } } })),
    enabled: !!studentId && !!schoolId,
  });
}

/** A style's belts with their stripes, in ladder order once flattened. */
export function useStyleRanks(disciplineId: string | null) {
  return useQuery({
    queryKey: ['style-ranks', disciplineId],
    queryFn: () => unwrap(apiClient.GET('/v1/styles/{disciplineId}/ranks', { params: { path: { disciplineId: disciplineId! } } })),
    enabled: !!disciplineId,
    staleTime: 60_000,
  });
}

export function useStyleSkills(disciplineId: string | null) {
  return useQuery({
    queryKey: ['style-skills', disciplineId],
    queryFn: () => unwrap(apiClient.GET('/v1/styles/{disciplineId}/skills', { params: { path: { disciplineId: disciplineId! } } })),
    enabled: !!disciplineId,
    staleTime: 60_000,
  });
}

/** Classes and weekly slots at the School; the dashboard keeps the coach's own. */
export function useSchoolClasses(schoolId: string | null) {
  return useQuery({
    queryKey: ['coach-classes', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/classes', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
    staleTime: 60_000,
  });
}

export function useSchoolTimetable(schoolId: string | null) {
  return useQuery({
    queryKey: ['coach-timetable', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/timetable', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
    staleTime: 60_000,
  });
}

/** Every grading write refreshes the student's panel and the boards. */
function useGradingMutation<TVars>(studentId: string, fn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['student-grading', studentId] }),
        queryClient.invalidateQueries({ queryKey: ['grading-board'] }),
      ]),
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

/** Verifies the belt the student declared, as it is (Decision 137). */
export function useVerifyRank(studentId: string, disciplineId: string) {
  return useGradingMutation(studentId, () =>
    unwrap(apiClient.POST('/v1/students/{id}/ranks/{disciplineId}/verify', { params: { path: { id: studentId, disciplineId } }, body: {} })),
  );
}

/** Cycles a skill: Not started → Learning → Signed off → Not started. */
export function useCycleSkill(studentId: string) {
  return useGradingMutation(studentId, (skillId: string) =>
    unwrap(apiClient.PATCH('/v1/students/{id}/skills/{skillId}', { params: { path: { id: studentId, skillId } } })),
  );
}

/** "Log a class" (Decisions 128 item 6, 176). */
export function useLogClass(studentId: string, disciplineId: string) {
  return useGradingMutation(studentId, (classType: string | null) =>
    unwrap(apiClient.POST('/v1/students/{id}/ranks/{disciplineId}/log-class', { params: { path: { id: studentId, disciplineId } }, body: { classType } })),
  );
}
