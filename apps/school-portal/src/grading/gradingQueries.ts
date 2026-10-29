import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, unwrap } from '@ultm8/api-client';
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
        // The board shows the same student (its right panel promotes too).
        queryClient.invalidateQueries({ queryKey: ['grading-board'] }),
      ]),
  });
}

export function usePromote(studentId: string, disciplineId: string) {
  return useGradingMutation(studentId, (body: GradingActionInput) =>
    unwrap(apiClient.POST('/v1/students/{id}/ranks/{disciplineId}/promote', { params: { path: { id: studentId, disciplineId } }, body })),
  );
}

/** Backlog 3.20: grade a Kids student into the linked Adult program. The
 * student then has a rank in the Adult style instead, so every style's
 * grading reads are refreshed (useGradingMutation's student and board keys). */
export function useMoveToAdult(studentId: string, kidsDisciplineId: string) {
  return useGradingMutation(studentId, (body: components['schemas']['MoveToAdultDto']) =>
    unwrap(apiClient.POST('/v1/students/{id}/ranks/{disciplineId}/move-to-adult', { params: { path: { id: studentId, disciplineId: kidsDisciplineId } }, body })),
  );
}

/** Backlog 3.20: "Ready for Adult from age" on a Kids style. */
export function useSetReadyForAdultAge() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ disciplineId, age }: { disciplineId: string; age: number }) =>
      unwrap(apiClient.PUT('/v1/disciplines/{id}/ready-for-adult-age', { params: { path: { id: disciplineId } }, body: { age } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['disciplines'] }),
  });
}

/** Decision 290: "Ranks shown as" Belts or Levels. Refreshes the styles and
 * their ladders, which carry it for the belt picture. */
export function useSetRankDisplay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ disciplineId, rankDisplay }: { disciplineId: string; rankDisplay: 'BELTS' | 'LEVELS' }) =>
      unwrap(apiClient.PUT('/v1/disciplines/{id}/rank-display', { params: { path: { id: disciplineId } }, body: { rankDisplay } })),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['disciplines'] });
      await queryClient.invalidateQueries({ queryKey: ['ranks'] });
    },
  });
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
/** The owner gives a student a home branch (Decisions 148, 168); used by the
 * board's "No branch" group (Decision 148.2). */
export function useSetHomeBranch(schoolId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, branchId }: { studentId: string; branchId: string }) =>
      unwrap(
        apiClient.PUT('/v1/schools/{id}/students/{studentId}/home-branch', {
          params: { path: { id: schoolId!, studentId } },
          body: { branchId },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['grading-board', schoolId] }),
  });
}

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
  return useBoardMutation(
    ({ studentId, classType, classId, minutes }: { studentId: string; classType: string | null; classId?: string | null; minutes?: number | null }) =>
      unwrap(
        apiClient.POST('/v1/students/{id}/ranks/{disciplineId}/log-class', {
          params: { path: { id: studentId, disciplineId } },
          body: { classType, classId: classId ?? null, minutes: classId ? null : minutes ?? null },
        }),
      ),
  );
}

/** The classes of one style that started in the last week, newest first:
 * what "Log a class" offers (Decision 301 item 5; the API logs the picked
 * class's length as hours trained). */
export function useRecentStyleClasses(schoolId: string | null, disciplineId: string) {
  return useQuery({
    queryKey: ['classes', schoolId, 'recent-of-style', disciplineId],
    queryFn: async () => {
      const now = new Date();
      const page = await unwrap(
        apiClient.GET('/v1/schools/{schoolId}/classes', {
          params: {
            path: { schoolId: schoolId! },
            query: { disciplineId, startsFrom: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString(), startsTo: now.toISOString(), limit: 100 },
          },
        }),
      );
      return [...page.items].sort((a, b) => b.startDate.localeCompare(a.startDate));
    },
    enabled: !!schoolId,
  });
}

/** The manual Active/Inactive switch for one style (Decisions 152, 176); null
 * follows the student's membership again. */
export function useSetBoardActive(disciplineId: string) {
  return useBoardMutation(({ studentId, active }: { studentId: string; active: boolean | null }) =>
    unwrap(apiClient.PUT('/v1/students/{id}/ranks/{disciplineId}/board-active', { params: { path: { id: studentId, disciplineId } }, body: { active } })),
  );
}

/** The API takes at most this many students per request (Decision 130). */
const BULK_BATCH = 200;

/**
 * A batch that stopped part-way: `done` holds what the earlier batches already
 * promoted, so the window can still report them (Decision 282), and
 * `remaining` the students not promoted yet, to try again (Decision 284).
 */
export class BulkPromotePartialError extends Error {
  constructor(
    readonly done: BulkPromoteResult,
    readonly remaining: string[],
    readonly reason: unknown,
  ) {
    super(reason instanceof Error ? reason.message : 'Bulk promote stopped part-way');
  }
}

/** A refusal (4xx) won't change on a second try; anything else (no answer, 5xx) may. */
const worthRetrying = (err: unknown) => !(err instanceof ApiError && err.status >= 400 && err.status < 500);

/**
 * Promote any number of students (Decision 282): the window sends them to the
 * API 200 at a time and joins the answers, so a coach never meets a limit. A
 * batch that gets no answer is sent once more on its own (Decision 284); that
 * is safe because each student carries the rung the check found them on
 * (`expected`), so one already promoted is skipped, never promoted twice.
 */
async function bulkPromoteInBatches(schoolId: string, body: BulkPromoteInput): Promise<BulkPromoteResult> {
  const merged: BulkPromoteResult = { ready: [], needsAcknowledgement: [], cannotPromote: [] };
  for (let i = 0; i < body.studentIds.length; i += BULK_BATCH) {
    const studentIds = body.studentIds.slice(i, i + BULK_BATCH);
    const inBatch = new Set(studentIds);
    const acknowledged = body.acknowledgedStudentIds?.filter((id) => inBatch.has(id));
    const expected = body.expected?.filter((e) => inBatch.has(e.studentId));
    const send = async () =>
      (await unwrap(
        apiClient.POST('/v1/schools/{schoolId}/grading/bulk-promote', {
          params: { path: { schoolId } },
          body: {
            ...body,
            studentIds,
            acknowledgedStudentIds: acknowledged?.length ? acknowledged : undefined,
            expected: expected?.length ? expected : undefined,
          },
        }),
      )) as BulkPromoteResult;
    let part: BulkPromoteResult;
    try {
      part = await send();
    } catch (err) {
      if (body.dryRun) throw err;
      try {
        if (!worthRetrying(err)) throw err;
        await new Promise((r) => setTimeout(r, 1500));
        part = await send();
      } catch (again) {
        // Nothing promoted and the API refused: a plain error, as before.
        if (i === 0 && !worthRetrying(again)) throw again;
        throw new BulkPromotePartialError(merged, body.studentIds.slice(i), again);
      }
    }
    merged.ready.push(...part.ready);
    merged.needsAcknowledgement.push(...part.needsAcknowledgement);
    merged.cannotPromote.push(...part.cannotPromote);
  }
  return merged;
}

/** Bulk promote (Decision 130). With dryRun it only checks, for the confirm window. */
export function useBulkPromote(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkPromoteInput) => bulkPromoteInBatches(schoolId, body),
    onSettled: async (_result, error, body) => {
      if (body.dryRun) return; // a check changes nothing
      if (error && !(error instanceof BulkPromotePartialError)) return;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['grading-board'] }),
        queryClient.invalidateQueries({ queryKey: ['student-grading'] }),
      ]);
    },
  });
}

/** A style's Grading Board columns (Decisions 75, 136, 181). */
export function useSetBoardThresholds(disciplineId: string) {
  const set = useSetAnyBoardThresholds();
  return { ...set, mutateAsync: (body: { gettingThere: number; readyToGrade: number }) => set.mutateAsync({ disciplineId, ...body }) };
}

/** The same, for whichever style is passed (Grading → Settings saves several). */
export function useSetAnyBoardThresholds() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ disciplineId, ...body }: { disciplineId: string; gettingThere: number; readyToGrade: number }) =>
      unwrap(apiClient.PUT('/v1/disciplines/{id}/board-thresholds', { params: { path: { id: disciplineId } }, body })),
    onSuccess: async (_data, { disciplineId }) => {
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

export type PromotionFeeRequest = components['schemas']['BoardFeeRequestDto'];

/** The owner waives or cancels a promotion fee; a coach dismisses a promotion
 * left "to decide" (Decisions 300, 307, 313). Waiving a waiting promotion
 * applies it; nothing else promotes on its own. */
export function useFeeRequestAction(action: 'waive' | 'cancel' | 'dismiss') {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (requestId: string) => {
      const params = { params: { path: { id: requestId } } };
      if (action === 'waive') return unwrap(apiClient.POST('/v1/promotion-fee-requests/{id}/waive', params));
      if (action === 'cancel') return unwrap(apiClient.POST('/v1/promotion-fee-requests/{id}/cancel', params));
      return unwrap(apiClient.POST('/v1/promotion-fee-requests/{id}/dismiss', params));
    },
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['grading-board'] }),
        queryClient.invalidateQueries({ queryKey: ['student-grading'] }),
      ]),
  });
}

export type StudentFeeRequest = components['schemas']['PromotionFeeRequestResponseDto'];

/** One student's promotion fee requests at this School, newest first. Under
 * 'student-grading' so grading and fee actions refresh it. */
export function useStudentFeeRequests(studentId: string | null, schoolId: string | null) {
  return useQuery({
    queryKey: ['student-grading', studentId, 'fee-requests', schoolId],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/promotion-fee-requests', { params: { path: { schoolId: schoolId! }, query: { studentId: studentId!, limit: 100 } } }),
      ),
    enabled: !!studentId && !!schoolId,
  });
}

/** The fee tag for one style, the board's rule (apps/api promotion-fee.ts
 * feeStatusFor): only a request that still concerns the current rung counts.
 * Waiting first, then "to decide", then declined. */
export function feeStatusOf(
  requests: StudentFeeRequest[],
  currentStripeId: string | null | undefined,
): { status: 'waiting' | 'declined' | 'toDecide'; request: StudentFeeRequest } | null {
  const onCurrent = (r: StudentFeeRequest) => (r.promotionApplied ? r.toRungId === currentStripeId : r.expectedCurrentRungId === currentStripeId);
  const waiting = requests.find((r) => r.promotionWaits && !r.promotionApplied && !r.toDecide && (r.status === 'PENDING' || r.status === 'ACCEPTED') && onCurrent(r));
  if (waiting) return { status: 'waiting', request: waiting };
  const toDecide = requests.find((r) => r.toDecide && r.expectedCurrentRungId === currentStripeId);
  if (toDecide) return { status: 'toDecide', request: toDecide };
  const declined = requests.find((r) => r.status === 'DECLINED' && onCurrent(r));
  if (declined) return { status: 'declined', request: declined };
  return null;
}

export type PromotionFeeSettings = components['schemas']['PromotionFeeSettingsResponseDto'];

/** Whether the School's promotion fee is on, and its currency (Decisions 287, 300). */
export function usePromotionFeeSettings(schoolId: string | null) {
  return useQuery({
    queryKey: ['promotion-fee-settings', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/promotion-fee-settings', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

/** The owner turns the promotion fee and "Allow grading before the fee is
 * paid" on or off (Decisions 297, 300, 307). */
export function useUpdatePromotionFeeSettings(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { promotionFeeEnabled?: boolean; gradeBeforeFeePaid?: boolean }) =>
      unwrap(apiClient.PUT('/v1/schools/{schoolId}/promotion-fee-settings', { params: { path: { schoolId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['promotion-fee-settings', schoolId] }),
  });
}

/** "Open mat counts toward hours" (Decisions 301, 304, 306). */
export function useOpenMatHours(schoolId: string | null) {
  return useQuery({
    queryKey: ['open-mat-hours', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/grading-settings/open-mat-hours', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

export function useSetOpenMatHours(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (openMatCountsTowardHours: boolean) =>
      unwrap(apiClient.PUT('/v1/schools/{schoolId}/grading-settings/open-mat-hours', { params: { path: { schoolId } }, body: { openMatCountsTowardHours } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['open-mat-hours', schoolId] }),
  });
}

export type RankCorrection = components['schemas']['RankCorrectionDto'];

/** Backlog 3.13: a student's waiting belt correction requests that the caller
 * may answer (the owner, or a coach with "Verify ranks" for that style). */
export function useStudentCorrections(schoolId: string | null, studentId: string | null) {
  return useQuery({
    queryKey: ['rank-corrections', schoolId, studentId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/rank-corrections', { params: { path: { schoolId: schoolId! }, query: { studentId: studentId! } } })),
    enabled: !!schoolId && !!studentId,
  });
}

/** Approve (the student moves, with a history entry) or reject a request. */
export function useAnswerCorrection(studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, answer, note }: { id: string; answer: 'approve' | 'reject'; note: string }) =>
      unwrap(
        answer === 'approve'
          ? apiClient.POST('/v1/rank-corrections/{id}/approve', { params: { path: { id } }, body: { note: note.trim() || null } })
          : apiClient.POST('/v1/rank-corrections/{id}/reject', { params: { path: { id } }, body: { note: note.trim() || null } }),
      ),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['rank-corrections'] }),
        queryClient.invalidateQueries({ queryKey: ['student-grading', studentId] }),
        queryClient.invalidateQueries({ queryKey: ['grading-board'] }),
      ]),
  });
}
