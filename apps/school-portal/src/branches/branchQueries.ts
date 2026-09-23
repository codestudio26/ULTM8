import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type BranchResponse = components['schemas']['BranchResponseDto'];
export type CreateBranchInput = components['schemas']['CreateBranchDto'];
export type UpdateBranchInput = components['schemas']['UpdateBranchDto'];

export function useBranches(schoolId: string | null) {
  return useQuery({
    queryKey: ['branches', schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/branches', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
    // FOUND ON REVIEW (Phase 17): Instructors/Classes/Timetable all call this
    // same hook to populate a Branch dropdown, and the global QueryClient
    // default is staleTime: 0 — without this, navigating between those
    // screens (a natural admin workflow, since all three reference Branches)
    // re-fetches the Branch list on every single page mount even though it
    // rarely changes. Any actual Branch create/update still invalidates this
    // query key directly (see useCreateBranch/useUpdateBranch below), so this
    // only affects how long an unrelated navigation can serve cached data.
    staleTime: 60_000,
  });
}

export function useCreateBranch(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateBranchInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/branches', { params: { path: { schoolId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['branches', schoolId] }),
  });
}

export function useUpdateBranch(schoolId: string, branchId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateBranchInput) =>
      unwrap(apiClient.PATCH('/v1/branches/{id}', { params: { path: { id: branchId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['branches', schoolId] }),
  });
}
