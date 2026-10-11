import { useQueries } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type Lesson = components['schemas']['LessonResponseDto'];

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
