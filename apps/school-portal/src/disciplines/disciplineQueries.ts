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
