import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type DisciplineResponse = components['schemas']['DisciplineResponseDto'];
export type CreateDisciplineInput = components['schemas']['CreateDisciplineDto'];
export type UpdateDisciplineInput = components['schemas']['UpdateDisciplineDto'];

/** No pagination in this UI yet — matches BranchesPage's own established
 * convention (the endpoint supports a cursor; nothing in this codebase's
 * frontend paginates a list screen yet, so this doesn't invent that pattern
 * here first). findAllDisciplines is also unpaginated server-side (returns
 * `{ items }` only, see RanksController). */
export function useDisciplines(schoolId: string | null) {
  return useQuery({
    queryKey: ['disciplines', schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/disciplines', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

/** Single-Discipline fetch — for the Discipline detail page (Skills/Ranks
 * management), which needs the Discipline's own name/classTypesOffered
 * without re-fetching the whole School's list. */
export function useDiscipline(disciplineId: string | null) {
  return useQuery({
    queryKey: ['discipline', disciplineId],
    queryFn: () => unwrap(apiClient.GET('/v1/disciplines/{id}', { params: { path: { id: disciplineId! } } })),
    enabled: !!disciplineId,
  });
}

export function useCreateDiscipline(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateDisciplineInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/disciplines', { params: { path: { schoolId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['disciplines', schoolId] }),
  });
}

export function useUpdateDiscipline(schoolId: string, disciplineId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateDisciplineInput) =>
      unwrap(apiClient.PATCH('/v1/disciplines/{id}', { params: { path: { id: disciplineId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['disciplines', schoolId] }),
  });
}

/** Deletes a style nobody has used (Decision 198). */
export function useDeleteDiscipline(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (disciplineId: string) => unwrap(apiClient.DELETE('/v1/disciplines/{id}', { params: { path: { id: disciplineId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['disciplines', schoolId] }),
  });
}

export type StyleTemplate = components['schemas']['StyleTemplateDto'];
export type StyleTemplateId = components['schemas']['CreateStyleFromTemplateDto']['templateId'];

/** The IBJJF ladders a style can start from (Decisions 131, 182). */
export function useStyleTemplates() {
  return useQuery({
    queryKey: ['style-templates'],
    queryFn: () => unwrap(apiClient.GET('/v1/style-templates')),
    staleTime: Infinity,
  });
}

/** A new style built from a template: the prototype's belts, rungs and
 * numbers, the school's own to edit afterwards. */
export function useCreateFromTemplate(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { templateId: StyleTemplateId; name?: string }) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/disciplines/from-template', { params: { path: { schoolId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['disciplines', schoolId] }),
  });
}

/** A copy of a style: ladder, skills and settings, no students (Decision 182). */
export function useDuplicateDiscipline(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (disciplineId: string) => unwrap(apiClient.POST('/v1/disciplines/{id}/duplicate', { params: { path: { id: disciplineId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['disciplines', schoolId] }),
  });
}
