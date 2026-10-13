import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type Lesson = components['schemas']['LessonResponseDto'];
export type Favorite = components['schemas']['FavoriteResponseDto'];
export type WatchHistoryEntry = components['schemas']['WatchHistoryResponseDto'];
export type Comment = components['schemas']['CommentResponseDto'];

/** GET /students/{id}/lessons?schoolId=, once per enrolled School — same
 * "a Student can hold a STUDENT RoleGrant at more than one School, so fan out
 * over every one of them" shape as `useAllEnrolledSchoolWaivers` in
 * waiverQueries.ts, but simpler: this endpoint has no pagination
 * (LessonListResponseDto is a flat `items` array, confirmed against
 * schema.d.ts — a School's Lesson catalogue is never remotely 100-deep the
 * way a paginated list elsewhere might be) and each Lesson already carries
 * its own `schoolId`, so there's no need to tag it on the way out the way
 * Waiver's DTO (which doesn't carry one) requires.
 *
 * `studentId` is the caller's own id only — Guardian-viewing-a-linked-
 * minor's Lessons is explicitly NOT built here: unlike grading
 * (MyGradingScreen's `studentId = route.params?.studentId ?? claims?.sub`),
 * this endpoint requires a `schoolId` the caller must already know, and
 * nothing client-visible resolves which School(s) a linked minor is
 * enrolled at (`MinorResponseDto` has no `schoolId` field;
 * `useEnrolledSchoolIds` only ever reads the CALLER's own JWT claims). That
 * gap is real, not an oversight — flagged in docs/TRACK-B-ROADMAP.md as a
 * follow-up rather than guessed at here. */
export function useLessonsForEnrolledSchools(studentId: string | null, schoolIds: string[]) {
  const results = useQueries({
    queries: schoolIds.map((schoolId) => ({
      queryKey: ['student-lessons', studentId, schoolId],
      queryFn: () =>
        unwrap(
          apiClient.GET('/v1/students/{id}/lessons', {
            params: { path: { id: studentId! }, query: { schoolId } },
          }),
        ),
      enabled: !!studentId,
    })),
  });

  const items: Lesson[] = [];
  results.forEach((r) => {
    if (r.data) items.push(...r.data.items);
  });

  return {
    items,
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
    error: results.find((r) => r.isError)?.error,
  };
}

/** GET /schools/{schoolId}/curriculum/categories, once per enrolled School —
 * "Read by anyone at the School (RLS)" per CurriculumService.findCategories's
 * own header comment, so a Student calling this for their own enrolled
 * Schools is exactly the access this endpoint already grants, not a new
 * exposure. Needed because `LessonResponseDto` only carries a category's
 * *name*, not its own position among the School's categories — only this
 * endpoint (ordered by `order`) has that, the same ordered list
 * CurriculumPage.tsx's `useLessonCategories` already reads on the Staff
 * side. Returns a flat `categoryId -> order` map (categoryIds are globally
 * unique, so merging across Schools is safe) — a Lesson's own `order` field
 * is a *different* number (its place within its category, not its
 * category's place among the others), so this must not be confused with
 * that one.
 *
 * Like `useEnrolledSchoolNames`, this resolves independently of the Lessons
 * fetch itself: on a slow network a School's categories can briefly still be
 * loading after its Lessons already rendered, showing categories in a
 * temporarily arbitrary order for a moment before this settles and the
 * correct order takes over — a display nicety, not a correctness risk worth
 * gating the whole screen's loading state on. */
export function useLessonCategoryOrder(schoolIds: string[]): Map<string, number> {
  const results = useQueries({
    queries: schoolIds.map((schoolId) => ({
      queryKey: ['lesson-categories', schoolId],
      queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/curriculum/categories', { params: { path: { schoolId } } })),
    })),
  });

  const orderByCategoryId = new Map<string, number>();
  results.forEach((r) => {
    r.data?.items.forEach((c) => orderByCategoryId.set(c.id, c.order));
  });
  return orderByCategoryId;
}

/** GET /schools/{schoolId}/curriculum/favorites, once per enrolled School — same
 * multi-School fan-out shape as `useLessonsForEnrolledSchools`. Requested at the
 * max page size (100, see PaginationQueryDto) as a single page per School rather
 * than draining every cursor page — same "wide single page, documented" precedent
 * as `useMyWaiverSignatures`/`useAllEnrolledSchoolWaivers` (waiverQueries.ts): a
 * Student realistically never approaches 100 favorited Lessons at one School.
 *
 * Returns a flat `Set<string>` of favorited lessonIds, not the raw Favorite rows —
 * every caller of this hook (LessonRow's star indicator, LessonDetailScreen's
 * toggle) only ever needs "is this lessonId favorited," never a Favorite's own id
 * or createdAt. */
export function useFavorites(schoolIds: string[]): {
  lessonIds: Set<string>;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
} {
  const results = useQueries({
    queries: schoolIds.map((schoolId) => ({
      queryKey: ['lesson-favorites', schoolId],
      queryFn: () =>
        unwrap(
          apiClient.GET('/v1/schools/{schoolId}/curriculum/favorites', {
            params: { path: { schoolId }, query: { limit: 100 } },
          }),
        ),
    })),
  });

  const lessonIds = new Set<string>();
  results.forEach((r) => {
    r.data?.items.forEach((f) => lessonIds.add(f.lessonId));
  });

  return {
    lessonIds,
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
    error: results.find((r) => r.isError)?.error,
  };
}

/** POST .../lessons/{id}/favorite — invalidates `useFavorites`' exact query key
 * for this School so a mounted LessonsScreen/LessonDetailScreen picks up the
 * change — "a quick mutation + refetch," not a hand-rolled optimistic update
 * (matches this app's existing mutation style, e.g. useCancelBooking in
 * bookingQueries.ts). */
export function useFavoriteLesson(schoolId: string, lessonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        apiClient.POST('/v1/schools/{schoolId}/curriculum/lessons/{id}/favorite', {
          params: { path: { schoolId, id: lessonId } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lesson-favorites', schoolId] }),
  });
}

/** DELETE .../lessons/{id}/favorite — idempotent server-side (a no-op if it
 * wasn't favorited), 204 on success. */
export function useUnfavoriteLesson(schoolId: string, lessonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        apiClient.DELETE('/v1/schools/{schoolId}/curriculum/lessons/{id}/favorite', {
          params: { path: { schoolId, id: lessonId } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lesson-favorites', schoolId] }),
  });
}

/** GET /schools/{schoolId}/curriculum/watch-history, once per enrolled School —
 * same fan-out/wide-single-page shape as `useFavorites` above. Ordered by
 * most-recently-updated (the backend's own sort); each row already carries its
 * own `schoolId`, so — unlike `useAllEnrolledSchoolWaivers` — nothing needs
 * tagging on the way out. Used for LessonsScreen's "Continue watching" section,
 * which further filters to `completedAt == null` and cross-references `lessonId`
 * against the already-fetched Lessons list for a title (WatchHistoryResponseDto
 * doesn't carry one) — see LessonsScreen.tsx. */
export function useWatchHistory(schoolIds: string[]) {
  const results = useQueries({
    queries: schoolIds.map((schoolId) => ({
      queryKey: ['watch-history', schoolId],
      queryFn: () =>
        unwrap(
          apiClient.GET('/v1/schools/{schoolId}/curriculum/watch-history', {
            params: { path: { schoolId }, query: { limit: 100 } },
          }),
        ),
    })),
  });

  const items: WatchHistoryEntry[] = [];
  results.forEach((r) => {
    if (r.data) items.push(...r.data.items);
  });

  return {
    items,
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
    error: results.find((r) => r.isError)?.error,
  };
}

/** POST .../lessons/{id}/watch-progress — called by LessonDetailScreen's video
 * player, throttled to roughly once per 10 seconds of playback plus once on
 * completion (`completed: true`) — never on every single player time-update
 * tick. Invalidates this School's watch-history query so a Student backing out
 * to LessonsScreen sees "Continue watching" reflect the position they just left
 * off at. */
export function useUpsertWatchProgress(schoolId: string, lessonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (dto: { lastPositionSeconds: number; completed?: boolean }) =>
      unwrap(
        apiClient.POST('/v1/schools/{schoolId}/curriculum/lessons/{id}/watch-progress', {
          params: { path: { schoolId, id: lessonId } },
          body: dto,
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['watch-history', schoolId] }),
  });
}

/** GET .../lessons/{id}/comments — oldest first (the backend's own sort, unlike
 * every other list in this file, which is newest-first — real chronological
 * thread order). Requested at the max page size (100) as a single page, same
 * "wide single page" precedent as elsewhere in this file; a single Lesson's
 * comment thread realistically never approaches 100 replies. Not part of the
 * task's own §5 hook list (which only named Favorite/WatchHistory hooks for this
 * file), but Comment is scoped by School+Lesson exactly like Favorite/
 * WatchHistory above, not by Playlist, so it lives here rather than in
 * playlistQueries.ts. */
export function useComments(schoolId: string, lessonId: string) {
  return useQuery({
    queryKey: ['lesson-comments', schoolId, lessonId],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/curriculum/lessons/{id}/comments', {
          params: { path: { schoolId, id: lessonId }, query: { limit: 100 } },
        }),
      ),
    enabled: !!lessonId,
  });
}

export function useCreateComment(schoolId: string, lessonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: string) =>
      unwrap(
        apiClient.POST('/v1/schools/{schoolId}/curriculum/lessons/{id}/comments', {
          params: { path: { schoolId, id: lessonId } },
          body: { body },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lesson-comments', schoolId, lessonId] }),
  });
}

/** DELETE /comments/{id} — a comment's own id, not a Lesson id, so no schoolId
 * is needed here; this route isn't nested under a School path at all. 204 on
 * success. The backend allows the comment's own author OR School staff to
 * delete it; if the caller is neither, it 403s — surfaced via
 * `getApiErrorMessage` on the call site rather than pre-emptively hidden here,
 * since this client has no cheap "am I staff at this School" signal to hide the
 * button correctly for a non-author Student (see this slice's own task
 * description). */
export function useDeleteComment(schoolId: string, lessonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) =>
      unwrap(apiClient.DELETE('/v1/comments/{id}', { params: { path: { id: commentId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lesson-comments', schoolId, lessonId] }),
  });
}
