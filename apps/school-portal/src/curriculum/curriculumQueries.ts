import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useDisciplines } from '../disciplines/disciplineQueries';
import type { SkillResponse } from '../skills/skillQueries';

export type LessonResponse = components['schemas']['LessonResponseDto'];
export type CreateLessonInput = components['schemas']['CreateLessonDto'];
export type UpdateLessonInput = components['schemas']['UpdateLessonDto'];

/** No pagination in this UI yet — same established convention as
 * useInstructors/useDisciplines (see their own header comments). Decision
 * 226 — always fetches `includeArchived: true`, same "fetch everything,
 * filter/toggle client-side" convention useBranches already established. */
export function useLessons(schoolId: string | null) {
  return useQuery({
    queryKey: ['lessons', schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/curriculum/lessons', { params: { path: { schoolId: schoolId! }, query: { includeArchived: true } } })),
    enabled: !!schoolId,
  });
}

export function useCreateLesson(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateLessonInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/curriculum/lessons', { params: { path: { schoolId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lessons', schoolId] }),
  });
}

export function useUpdateLesson(schoolId: string, lessonId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateLessonInput) => unwrap(apiClient.PATCH('/v1/lessons/{id}', { params: { path: { id: lessonId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lessons', schoolId] }),
  });
}

/** Deletes a lesson (Decision 198). Owner only. */
export function useDeleteLesson(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lessonId: string) => unwrap(apiClient.DELETE('/v1/lessons/{id}', { params: { path: { id: lessonId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lessons', schoolId] }),
  });
}

/** Decision 226 — reversible alternative to useDeleteLesson above (coexists
 * with it): School Owner/Manager only, idempotent, no dependents to block
 * it today. */
export function useArchiveLesson(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lessonId: string) => unwrap(apiClient.POST('/v1/lessons/{id}/archive', { params: { path: { id: lessonId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lessons', schoolId] }),
  });
}

export function useUnarchiveLesson(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lessonId: string) => unwrap(apiClient.POST('/v1/lessons/{id}/unarchive', { params: { path: { id: lessonId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lessons', schoolId] }),
  });
}

export type VideoUploadUrlResponse = components['schemas']['VideoUploadUrlResponseDto'];

/** Decision 101's long-unbuilt video pipeline is now wired for real
 * (`curriculum.service.ts`'s own `requestVideoUploadUrl`, staff-gated): a
 * Cloudflare Stream "direct creator upload" URL the caller PUTs the raw
 * video file to directly (never through this app's own backend — see
 * VideoUploadModal's own header comment). The backend sets
 * `captionStatus` to PROCESSING and writes `videoRef` onto the Lesson the
 * instant THIS call succeeds — before the actual PUT even starts — so
 * invalidating `['lessons', schoolId]` here immediately reflects that, same
 * as every other mutation in this file; it does not, and cannot, tell us
 * when the async Cloudflare Stream + AWS Transcribe pipeline
 * (`VideoProcessingPollScheduler`) actually finishes and flips captionStatus
 * to READY.
 *
 * FOUND ON REVIEW: the generated operation type
 * (`CurriculumController_requestVideoUploadUrl`) only declares `id` as a path
 * param — matching `curriculum.controller.ts`'s route handler, which never
 * reads `:schoolId` from the URL at all (the service derives the School from
 * the Lesson itself, same as the sibling favorite/watch-progress/comments
 * endpoints) — even though the literal path template below still contains
 * `{schoolId}`. openapi-fetch's runtime path serializer does a blind
 * regex-replace of every `{token}` in the URL string using whatever keys
 * exist in `params.path`, with no regard for the declared type; omitting
 * schoolId here would leave the literal substring `{schoolId}` in the
 * request URL and 404. `pathParams` is built as its own (non-literal)
 * variable specifically so TypeScript's excess-property check on object
 * literals doesn't fire for the extra `schoolId` key the declared type
 * doesn't know about. */
/** Decision 227/254's own review pass fixed the backend to actually bind and
 * verify `:schoolId` (previously present in the URL but silently ignored by
 * the controller — see CurriculumService.requestVideoUploadUrl's own
 * comment) — the generated client type now genuinely includes `schoolId`,
 * so no path-param workaround is needed here. */
export function useRequestVideoUploadUrl(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lessonId: string) =>
      unwrap(
        apiClient.POST('/v1/schools/{schoolId}/curriculum/lessons/{id}/video-upload-url', {
          params: { path: { schoolId, id: lessonId } },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['lessons', schoolId] }),
  });
}

/** Whether lesson videos can be uploaded on this server yet (C4): off until
 * the video account is set up (v1.3, Decision 267). */
export function useVideoUploadStatus(schoolId: string | null) {
  return useQuery({
    queryKey: ['video-uploads', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/curriculum/video-uploads', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
    staleTime: 5 * 60_000,
  });
}

export type LessonCategory = components['schemas']['LessonCategoryResponseDto'];

/** The School's lesson categories, in order (Decisions 128.15, 191). */
export function useLessonCategories(schoolId: string | null) {
  return useQuery({
    queryKey: ['lesson-categories', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/curriculum/categories', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

/** Any category write changes how lessons are grouped and ordered too. */
function useCategoryMutation<TVars>(schoolId: string, fn: (vars: TVars) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['lesson-categories', schoolId] }),
        queryClient.invalidateQueries({ queryKey: ['lessons', schoolId] }),
      ]),
  });
}

export function useCreateLessonCategory(schoolId: string) {
  return useCategoryMutation(schoolId, (name: string) =>
    unwrap(apiClient.POST('/v1/schools/{schoolId}/curriculum/categories', { params: { path: { schoolId } }, body: { name } })),
  );
}

export function useRenameLessonCategory(schoolId: string) {
  return useCategoryMutation(schoolId, (v: { id: string; name: string }) =>
    unwrap(apiClient.PATCH('/v1/curriculum/categories/{id}', { params: { path: { id: v.id } }, body: { name: v.name } })),
  );
}

export function useOrderLessonCategories(schoolId: string) {
  return useCategoryMutation(schoolId, (categoryIds: string[]) =>
    unwrap(apiClient.PUT('/v1/schools/{schoolId}/curriculum/categories/order', { params: { path: { schoolId } }, body: { categoryIds } })),
  );
}

export function useOrderCategoryLessons(schoolId: string) {
  return useCategoryMutation(schoolId, (v: { categoryId: string; lessonIds: string[] }) =>
    unwrap(apiClient.PUT('/v1/curriculum/categories/{id}/lessons/order', { params: { path: { id: v.categoryId } }, body: { lessonIds: v.lessonIds } })),
  );
}

export interface DisciplineSkillGroup {
  disciplineId: string;
  disciplineName: string;
  /** An archived style: the lesson form shows only the skills a lesson
   * already has from it, so they can be unticked (C10). */
  archived: boolean;
  skills: SkillResponse[];
}

/** Lesson.skillIds (CreateLessonDto/UpdateLessonDto) can reference a Skill from
 * ANY Discipline at the School — unlike Rank's own requiredSkillIds, which is
 * scoped to the one Discipline it belongs to. There's no School-wide "list all
 * Skills" endpoint (Skill is only ever read nested under a Discipline, per
 * skillQueries.ts's own header comment), so this fans out: one query per
 * Discipline via useQueries, grouped for the checkbox list in
 * LessonFormModal. Loading/error state is the union of all of them. */
export function useSchoolSkillGroups(schoolId: string | null) {
  const { data: disciplineData, isLoading: disciplinesLoading, error: disciplinesError } = useDisciplines(schoolId, { includeArchived: true });
  const disciplines = disciplineData?.items ?? [];

  const skillQueries = useQueries({
    queries: disciplines.map((d) => ({
      queryKey: ['skills', d.id],
      queryFn: () => unwrap(apiClient.GET('/v1/styles/{disciplineId}/skills', { params: { path: { disciplineId: d.id } } })),
      enabled: !!schoolId,
    })),
  });

  const isLoading = disciplinesLoading || skillQueries.some((q) => q.isLoading);
  const error = disciplinesError ?? skillQueries.find((q) => q.error)?.error ?? null;

  const groups: DisciplineSkillGroup[] = disciplines.map((d, i) => ({
    disciplineId: d.id,
    disciplineName: d.name,
    archived: !!d.archivedAt,
    skills: skillQueries[i]?.data?.items ?? [],
  }));

  return { groups, isLoading, error };
}
