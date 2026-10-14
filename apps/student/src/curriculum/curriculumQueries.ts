import { useQueries, useQuery } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type Lesson = components['schemas']['LessonResponseDto'];

/** GET /students/{id}/lessons, `schoolId` omitted — every enrolled School's
 * Lessons in one call, for the student themselves or a guardian of theirs
 * (Decisions 154, 190, 195), same unified shape `useGradingOverview`
 * (myGradingQueries.ts) already established for the identical problem: a
 * guardian's own JWT carries no claims about a linked minor's enrollment, so
 * the client can't resolve a `schoolId` to pass in ahead of time the way the
 * Staff-facing per-School endpoints can. Each returned Lesson already
 * carries its own `schoolId` (LessonResponseDto), so the screen can still
 * group by School from this one response. */
export function useLessonsOverviewForStudent(studentId: string | null) {
  return useQuery({
    queryKey: ['student-lessons-overview', studentId],
    queryFn: () => unwrap(apiClient.GET('/v1/students/{id}/lessons', { params: { path: { id: studentId! } } })),
    enabled: !!studentId,
  });
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
