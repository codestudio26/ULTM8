import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type RankResponse = components['schemas']['RankResponseDto'];
export type RankStripeTierInput = components['schemas']['RankStripeTierInputDto'];
export type CreateRankInput = components['schemas']['CreateRankDto'];
export type UpdateRankInput = components['schemas']['UpdateRankDto'];

/** Ranks are nested under a Discipline (`/styles/:disciplineId/ranks`), same
 * shape as Skills — no School-wide "list all Ranks" endpoint. Unpaginated
 * server-side (`{ items }` only, ordered by `order` already). */
export function useRanks(disciplineId: string | null) {
  return useQuery({
    queryKey: ['ranks', disciplineId],
    queryFn: () => unwrap(apiClient.GET('/v1/styles/{disciplineId}/ranks', { params: { path: { disciplineId: disciplineId! } } })),
    enabled: !!disciplineId,
  });
}

export function useCreateRank(disciplineId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateRankInput) =>
      unwrap(apiClient.POST('/v1/styles/{disciplineId}/ranks', { params: { path: { disciplineId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ranks', disciplineId] }),
  });
}

export function useUpdateRank(disciplineId: string, rankId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateRankInput) =>
      unwrap(apiClient.PATCH('/v1/ranks/{id}', { params: { path: { id: rankId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['ranks', disciplineId] }),
  });
}
