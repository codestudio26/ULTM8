import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';
import { ALL_PAGES_LIMIT, fetchAllPages } from '../lib/fetchAllPages';

export type MembershipPlanResponse = components['schemas']['MembershipPlanResponseDto'];
export type CreateMembershipPlanInput = components['schemas']['CreateMembershipPlanDto'];
export type UpdateMembershipPlanInput = components['schemas']['UpdateMembershipPlanDto'];

/** Every plan of the School, all pages. The API returns 20 a page by
 * default, and this list used to stop there, so a School's 21st plan never
 * showed (Memberships review M5, Decision 334). Same `{ items }` shape as one
 * page, so callers are unchanged. */
export function useMembershipPlans(schoolId: string | null) {
  return useQuery({
    queryKey: ['membershipPlans', schoolId],
    queryFn: async () => ({
      items: await fetchAllPages((cursor) =>
        unwrap(
          apiClient.GET('/v1/schools/{schoolId}/membership-plans', {
            params: { path: { schoolId: schoolId! }, query: { cursor, limit: ALL_PAGES_LIMIT } },
          }),
        ),
      ),
    }),
    enabled: !!schoolId,
  });
}

/** Single-plan fetch via the already-existing `GET /v1/membership-plans/{id}`
 * endpoint — previously unused by the frontend, which only ever read a plan
 * out of the already-fetched `useMembershipPlans` list. Lets the Edit page
 * load directly from a URL/refresh without depending on the List page's
 * in-memory array having been fetched first. */
export function useMembershipPlan(id: string | null) {
  return useQuery({
    queryKey: ['membershipPlan', id],
    queryFn: () => unwrap(apiClient.GET('/v1/membership-plans/{id}', { params: { path: { id: id! } } })),
    enabled: !!id,
  });
}

export function useCreateMembershipPlan(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateMembershipPlanInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/membership-plans', { params: { path: { schoolId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['membershipPlans', schoolId] }),
  });
}

export function useUpdateMembershipPlan(schoolId: string, planId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateMembershipPlanInput) =>
      unwrap(apiClient.PATCH('/v1/membership-plans/{id}', { params: { path: { id: planId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['membershipPlans', schoolId] }),
  });
}

/** Same PATCH /v1/membership-plans/{id} endpoint as useUpdateMembershipPlan, but not
 * bound to one planId ahead of time — lets the list page toggle any row's Visibility
 * inline with a single mutation instance, instead of one hook instance per row.
 * Sending only `{ visible }` is safe: MembershipsService.updatePlan() leaves every
 * other field (type/price/classesIncluded/etc.) untouched when its DTO key is
 * undefined, so this never touches FRIEND_PASS's forced price=0 or any other
 * cross-field rule.
 *
 * The cast below is required only because of a real, pre-existing codegen gap: the
 * OpenAPI schema for UpdateMembershipPlanDto has NO `required` array at all (checked
 * directly — every field, including `visible`/`termsWaiverRequired`, is genuinely
 * optional there, matching MembershipsService.updatePlan()'s own undefined-tolerant
 * handling), yet openapi-typescript still generates `visible`/`termsWaiverRequired`
 * as non-optional TS fields — it treats any `@ApiPropertyOptional({ default })`
 * field this way. The same gap affects ~10 other DTOs across Schools/Franchises/
 * Classes/TimetableSlots/Ranks/Grading (grepped `default` properties absent from
 * `required[]` across the whole schema to confirm the pattern, not guessed) — logged
 * in docs/v1.2-backend-backlog.md as a codegen/tooling fix rather than worked around
 * ad hoc in every affected caller. */
/**
 * v1.2 backend backlog — MembershipPlansPage's "Active members" stat tile.
 * The backend endpoint is per-plan (GET /membership-plans/{id}/active-count);
 * the ribbon shows one School-wide total, so this fans out one request per
 * plan (via useQueries, not N separate hook instances) and sums them —
 * acceptable at this page's existing unpaginated-list scale (same convention
 * useMembershipPlans itself already accepts), not a new performance
 * assumption this page didn't already make.
 */
/** v1.2 backend backlog — Subscription price-change migrate-vs-grandfather
 * prompt. Single-plan read of the same GET /membership-plans/{id}/active-count
 * endpoint useActiveMemberTotal fans out over — MembershipPlanFormPage needs
 * exactly one plan's own count (to decide whether the Migrate/Grandfather
 * prompt is even relevant) rather than a School-wide sum, so this is its own
 * small hook rather than reusing useActiveMemberTotal with a one-item array. */
export function useMembershipPlanActiveCount(id: string | null) {
  return useQuery({
    queryKey: ['membershipPlan', id, 'active-count'],
    queryFn: () => unwrap(apiClient.GET('/v1/membership-plans/{id}/active-count', { params: { path: { id: id! } } })),
    enabled: !!id,
  });
}

export function useActiveMemberTotal(planIds: string[]) {
  const results = useQueries({
    queries: planIds.map((id) => ({
      queryKey: ['membershipPlan', id, 'active-count'],
      queryFn: () => unwrap(apiClient.GET('/v1/membership-plans/{id}/active-count', { params: { path: { id } } })),
    })),
  });
  const isLoading = results.some((r) => r.isLoading);
  const error = results.find((r) => r.error)?.error ?? null;
  const total = results.reduce((sum, r) => sum + (r.data?.activeCount ?? 0), 0);
  return { total, isLoading, error };
}

export function useUpdateMembershipPlanVisibility(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, visible }: { id: string; visible: boolean }) =>
      unwrap(
        apiClient.PATCH('/v1/membership-plans/{id}', {
          params: { path: { id } },
          body: { visible } as UpdateMembershipPlanInput,
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['membershipPlans', schoolId] }),
  });
}

/** v1.2 backend backlog "Archive action" — MembershipPlansPage's row action.
 * Not bound to one planId ahead of time, same shape
 * useUpdateMembershipPlanVisibility already established for a list-page
 * inline mutation. */
export function useArchiveMembershipPlan(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(apiClient.POST('/v1/membership-plans/{id}/archive', { params: { path: { id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['membershipPlans', schoolId] }),
  });
}

export function useUnarchiveMembershipPlan(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => unwrap(apiClient.POST('/v1/membership-plans/{id}/unarchive', { params: { path: { id } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['membershipPlans', schoolId] }),
  });
}
