import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type SkillResponse = components['schemas']['SkillResponseDto'];
export type CreateSkillInput = components['schemas']['CreateSkillDto'];
export type UpdateSkillInput = components['schemas']['UpdateSkillDto'];

/** Skills are nested under a Discipline (`/styles/:disciplineId/skills`, per
 * RanksController's own routing comment on why "styles" and "disciplineId"
 * mean the same thing) — no School-wide "list all Skills" endpoint exists,
 * matching this module's overall "scoped through the Discipline" shape.
 * Unpaginated server-side (`{ items }` only, no cursor). */
export function useSkills(disciplineId: string | null) {
  return useQuery({
    queryKey: ['skills', disciplineId],
    queryFn: () => unwrap(apiClient.GET('/v1/styles/{disciplineId}/skills', { params: { path: { disciplineId: disciplineId! } } })),
    enabled: !!disciplineId,
  });
}

export function useCreateSkill(disciplineId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateSkillInput) =>
      unwrap(apiClient.POST('/v1/styles/{disciplineId}/skills', { params: { path: { disciplineId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills', disciplineId] }),
  });
}

export function useUpdateSkill(disciplineId: string, skillId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateSkillInput) =>
      unwrap(apiClient.PATCH('/v1/skills/{id}', { params: { path: { id: skillId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['skills', disciplineId] }),
  });
}
