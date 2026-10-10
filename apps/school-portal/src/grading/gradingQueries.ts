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

/** Every grading write refreshes the whole panel: rank, readiness and history,
 * and the list of belts waiting to be verified. */
function useGradingMutation<TVars>(studentId: string, fn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['student-grading', studentId] }),
        queryClient.invalidateQueries({ queryKey: ['pending-verifications'] }),
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

/** Edit a history entry's note, or hide or show it (Decision 192). */
export function useChangeHistoryNote(studentId: string, schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, ...body }: { eventId: string; note?: string | null; hidden?: boolean }) =>
      unwrap(
        apiClient.PATCH('/v1/students/{id}/rank-history/{eventId}/note', {
          params: { path: { id: studentId, eventId }, query: { schoolId } },
          body,
        }),
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['student-grading', studentId] }),
        queryClient.invalidateQueries({ queryKey: ['history-note-log', studentId] }),
      ]),
  });
}

/** Every change to one entry's note, for the School owner (Decision 192). */
export function useHistoryNoteLog(studentId: string, schoolId: string, eventId: string | null) {
  return useQuery({
    queryKey: ['history-note-log', studentId, eventId],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/students/{id}/rank-history/{eventId}/note-log', {
          params: { path: { id: studentId, eventId: eventId! }, query: { schoolId } },
        }),
      ),
    enabled: !!eventId,
  });
}

export type GradingBoard = components['schemas']['GradingBoardResponseDto'];
export type GradingBoardItem = components['schemas']['GradingBoardItemDto'];
export type BoardColumn = 'JUST_STARTING' | 'GETTING_THERE' | 'READY_TO_GRADE';
export type BulkPromoteInput = components['schemas']['BulkPromoteDto'];
export type BulkPromoteResult = components['schemas']['BulkPromoteResponseDto'];
export type BulkPromoteStudent = components['schemas']['BulkPromoteStudentDto'];

/** The Grading Board for one style (Decisions 136, 152, 168, 176): every
 * student with a next rank, highest progress first. Search is done on the
 * page, over the loaded list. */
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

/** Board writes change the board and the student's panel. */
function useBoardMutation<TVars>(fn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['grading-board'] }),
        queryClient.invalidateQueries({ queryKey: ['student-grading'] }),
      ]);
    },
  });
}

/** Board drag (Decision 128, item 13): rewrites progress so the student lands
 * in the column, recorded on the history. */
export function useBoardMove(disciplineId: string) {
  return useBoardMutation(({ studentId, column }: { studentId: string; column: BoardColumn }) =>
    unwrap(apiClient.POST('/v1/students/{id}/ranks/{disciplineId}/board-move', { params: { path: { id: studentId, disciplineId } }, body: { column } })),
  );
}

/** "Log a class" (Decisions 128 item 6, 176). */
export function useLogClass(disciplineId: string) {
  return useBoardMutation(({ studentId, classType }: { studentId: string; classType: string | null }) =>
    unwrap(apiClient.POST('/v1/students/{id}/ranks/{disciplineId}/log-class', { params: { path: { id: studentId, disciplineId } }, body: { classType } })),
  );
}

/** The manual Active/Inactive switch for one style (Decisions 152, 176); null
 * follows the student's membership again. */
export function useSetBoardActive(disciplineId: string) {
  return useBoardMutation(({ studentId, active }: { studentId: string; active: boolean | null }) =>
    unwrap(apiClient.PUT('/v1/students/{id}/ranks/{disciplineId}/board-active', { params: { path: { id: studentId, disciplineId } }, body: { active } })),
  );
}

/** Bulk promote (Decision 130). With dryRun it only checks, for the confirm window. */
export function useBulkPromote(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkPromoteInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/grading/bulk-promote', { params: { path: { schoolId } }, body })) as Promise<BulkPromoteResult>,
    onSuccess: async (_result, body) => {
      if (body.dryRun) return; // a check changes nothing
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['grading-board'] }),
        queryClient.invalidateQueries({ queryKey: ['student-grading'] }),
      ]);
    },
  });
}

/** A style's Grading Board columns (Decisions 75, 136, 181). */
export function useSetBoardThresholds(disciplineId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { gettingThere: number; readyToGrade: number }) =>
      unwrap(apiClient.PUT('/v1/disciplines/{id}/board-thresholds', { params: { path: { id: disciplineId } }, body })),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['disciplines'] }),
        queryClient.invalidateQueries({ queryKey: ['discipline', disciplineId] }),
        queryClient.invalidateQueries({ queryKey: ['grading-board'] }),
        queryClient.invalidateQueries({ queryKey: ['student-grading'] }),
      ]);
    },
  });
}

export type MyGradingPermissions = components['schemas']['MyGradingPermissionsResponseDto'];
export type GradingToggle =
  | 'canPromote'
  | 'canDowngrade'
  | 'canSignOffSkills'
  | 'canAdjustProgress'
  | 'canVerifyRanks'
  | 'canVoidHistory'
  | 'canChangeBoardThresholds';

/** What the caller may do in each style (Decisions 181, 184): the owner
 * everything; a coach only their own styles and toggles. The API enforces it
 * either way; this only hides what they can't use. */
export function useMyGrading(schoolId: string | null) {
  const query = useQuery({
    queryKey: ['grading-permissions', 'me', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/grading-permissions/me', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
  const data = query.data;
  const isOwner = data?.isOwner ?? false;
  const styleIds = new Set((data?.items ?? []).map((p) => p.disciplineId));
  const can = (disciplineId: string | null | undefined, toggle: GradingToggle) => {
    if (!data || !disciplineId) return false;
    if (data.isOwner) return true;
    const row = data.items.find((p) => p.disciplineId === disciplineId);
    return !!row && row[toggle];
  };
  const mayGradeStyle = (disciplineId: string) => isOwner || styleIds.has(disciplineId);
  return { isLoading: query.isLoading, error: query.error, isOwner, can, mayGradeStyle };
}

/** Belts waiting to be verified that this person may verify (Decisions 137,
 * 189): every student's for the owner; their styles and branches for a coach. */
export function usePendingVerifications(schoolId: string | null) {
  return useQuery({
    queryKey: ['pending-verifications', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/rank-verifications', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}
