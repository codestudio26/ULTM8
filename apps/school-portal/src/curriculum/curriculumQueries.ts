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
 * useInstructors/useDisciplines (see their own header comments). */
export function useLessons(schoolId: string | null) {
  return useQuery({
    queryKey: ['lessons', schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/curriculum/lessons', { params: { path: { schoolId: schoolId! } } })),
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

export interface DisciplineSkillGroup {
  disciplineId: string;
  disciplineName: string;
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
  const { data: disciplineData, isLoading: disciplinesLoading, error: disciplinesError } = useDisciplines(schoolId);
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
    skills: skillQueries[i]?.data?.items ?? [],
  }));

  return { groups, isLoading, error };
}
