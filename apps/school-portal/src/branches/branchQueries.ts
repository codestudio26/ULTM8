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

export type BranchListItem = components['schemas']['BranchListItemDto'];

/** Decision 294 — the Branches page's filters, all optional and combinable. */
export interface BranchFilters {
  /** Exact city (case and accents ignored), from the page's City dropdown. */
  city?: string;
  /** Branch name, city or postcode. */
  q?: string;
  /** ISO 3166-1 alpha-2. */
  country?: string;
}

/** Every Branch of the School, sorted by name, archived ones included.
 *
 * Decision 294 — follows `nextCursor` until the list ends. The endpoint pages
 * at 20 by default and nothing here asked for more, so a School with over 20
 * Branches silently lost the rest on the Branches page and in every Branch
 * picker (Instructors/Classes/Timetable/Staff/... all call this hook).
 *
 * Decision 226 — always fetches `includeArchived: true` so the Branches
 * page can compute an accurate "Archived" count and let the caller toggle
 * their visibility client-side; the actual default-hide happens in
 * BranchesPage's own render, not here. */
export function useBranches(schoolId: string | null, filters: BranchFilters = {}) {
  const { city, q, country } = filters;
  return useQuery({
    queryKey: ['branches', schoolId, city ?? null, q ?? null, country ?? null],
    queryFn: async () => {
      const items: BranchListItem[] = [];
      let cursor: string | undefined;
      do {
        const page = await unwrap(
          apiClient.GET('/v1/schools/{schoolId}/branches', {
            params: {
              path: { schoolId: schoolId! },
              query: { city: city || undefined, q: q || undefined, country: country || undefined, includeArchived: true, limit: 100, cursor },
            },
          }),
        );
        items.push(...page.items);
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
      return { items };
    },
    enabled: !!schoolId,
    // Typing in the search box keeps showing the last results until the new
    // ones arrive, instead of flashing the spinner on every keystroke.
    placeholderData: (previous) => previous,
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

/** Branch picker options (Decision 293): archived Branches are left out, so
 * nothing new gets assigned to a Branch that is waiting to be purged —
 * except `keepId`, the Branch the record being edited already points at,
 * shown with an "(Archived)" suffix so the form doesn't look like it lost
 * it. `useBranches` still returns every Branch, so name lookups for
 * existing rows keep working. */
export function branchSelectOptions(
  branches: BranchResponse[],
  archivedLabel: string,
  keepId?: string | null,
): { value: string; label: string }[] {
  return branches
    .filter((b) => !b.archivedAt || b.id === keepId)
    .map((b) => ({ value: b.id, label: b.archivedAt ? `${b.name} (${archivedLabel})` : b.name }));
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
 * active dependents (any Class, weekly timetable slot (Decision 293),
 * Instructor profile, Student, or active staff/instructor role grant scoped
 * to this Branch). */
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
