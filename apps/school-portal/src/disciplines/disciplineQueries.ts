import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useOwnedSchoolIds } from '../auth/AuthContext';
import { useMyStaffPermission } from '../roleGrants/coachInviteQueries';

export type DisciplineResponse = components['schemas']['DisciplineResponseDto'];
export type CreateDisciplineInput = components['schemas']['CreateDisciplineDto'];
export type UpdateDisciplineInput = components['schemas']['UpdateDisciplineDto'];

/** No pagination in this UI yet — matches BranchesPage's own established
 * convention (the endpoint supports a cursor; nothing in this codebase's
 * frontend paginates a list screen yet, so this doesn't invent that pattern
 * here first). findAllDisciplines is also unpaginated server-side (returns
 * `{ items }` only, see RanksController). */
export function useDisciplines(schoolId: string | null, options: { includeArchived?: boolean } = {}) {
  const includeArchived = options.includeArchived ?? false;
  // Archived styles are left out unless asked for (Decision 309), so every
  // picker that calls this hides them; the Disciplines page asks for them.
  return useQuery({
    queryKey: ['disciplines', schoolId, ...(includeArchived ? ['withArchived'] : [])],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/disciplines', {
          params: { path: { schoolId: schoolId! }, query: includeArchived ? { includeArchived: true } : undefined },
        }),
      ),
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
    // A rename or class type change also reaches classes, slots, instructors
    // and rungs (Decisions 308, 309).
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['disciplines', schoolId] }),
        queryClient.invalidateQueries({ queryKey: ['discipline', disciplineId] }),
        queryClient.invalidateQueries({ queryKey: ['ranks', disciplineId] }),
        queryClient.invalidateQueries({ queryKey: ['classes'] }),
        queryClient.invalidateQueries({ queryKey: ['timetable'] }),
        queryClient.invalidateQueries({ queryKey: ['instructors'] }),
      ]),
  });
}

/** Archive (retire) a style, or bring it back (Decision 309). */
export function useSetDisciplineArchived(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, archived }: { id: string; archived: boolean }) =>
      unwrap(apiClient.POST(archived ? '/v1/disciplines/{id}/archive' : '/v1/disciplines/{id}/unarchive', { params: { path: { id } } })),
    onSuccess: (_data, { id }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['disciplines', schoolId] }),
        queryClient.invalidateQueries({ queryKey: ['discipline', id] }),
      ]),
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

/** May the caller change this School's styles, belts and skills (Decision
 * 383): the owner, or Branch Staff the owner ticked "Can manage disciplines"
 * for. A display hint only; the API checks again. */
export function useCanManageDisciplines(schoolId: string | null | undefined): boolean {
  const isOwner = useOwnedSchoolIds().includes(schoolId ?? '');
  const mine = useMyStaffPermission(!isOwner && schoolId ? schoolId : null);
  return isOwner || !!mine.data?.canManageDisciplines;
}
