import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type BranchResponse = components['schemas']['BranchResponseDto'];
export type CreateBranchInput = components['schemas']['CreateBranchDto'];
export type UpdateBranchInput = components['schemas']['UpdateBranchDto'];

/** Single-Branch fetch — for the Decision 231 Branch settings page, which
 * needs the Branch's own fields without re-fetching the whole list (same
 * shape as useFranchise's identical single-fetch hook). */
export function useBranch(branchId: string | null) {
  return useQuery({
    queryKey: ['branch', branchId],
    queryFn: () => unwrap(apiClient.GET('/v1/branches/{id}', { params: { path: { id: branchId! } } })),
    enabled: !!branchId,
  });
}

/** `city` — additive, optional filter (Branches page's City filter, now wired to the
 * real `GET /schools/:schoolId/branches?city=` server-side filter instead of
 * filtering an already-fetched list client-side). Omitted (the default, used by
 * every other caller of this hook — Instructors/Classes/Timetable's Branch
 * dropdowns), behaves exactly as before this filter existed. */
/** Decision 226 — always fetches `includeArchived: true` so the Branches
 * page can compute an accurate "Archived" count and let the caller toggle
 * their visibility client-side, same "excluded by default, visible via a
 * filter" convention this build applies to every one of the 7 entities;
 * the actual default-hide happens in BranchesPage's own render, not here. */
export function useBranches(schoolId: string | null, city?: string) {
  return useQuery({
    queryKey: ['branches', schoolId, city ?? null],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/branches', {
          params: { path: { schoolId: schoolId! }, query: { city: city || undefined, includeArchived: true } },
        }),
      ),
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branches', schoolId] });
      queryClient.invalidateQueries({ queryKey: ['branch', branchId] });
    },
  });
}

/** Decision 226 — School Owner/Manager only, idempotent, blocked (409) by
 * active dependents (any Class, Instructor profile, Student, or active
 * staff/instructor role grant scoped to this Branch). */
export function useArchiveBranch(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (branchId: string) => unwrap(apiClient.POST('/v1/branches/{id}/archive', { params: { path: { id: branchId } } })),
    onSuccess: (_data, branchId) => {
      queryClient.invalidateQueries({ queryKey: ['branches', schoolId] });
      queryClient.invalidateQueries({ queryKey: ['branch', branchId] });
    },
  });
}

export function useUnarchiveBranch(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (branchId: string) => unwrap(apiClient.POST('/v1/branches/{id}/unarchive', { params: { path: { id: branchId } } })),
    onSuccess: (_data, branchId) => {
      queryClient.invalidateQueries({ queryKey: ['branches', schoolId] });
      queryClient.invalidateQueries({ queryKey: ['branch', branchId] });
    },
  });
}
