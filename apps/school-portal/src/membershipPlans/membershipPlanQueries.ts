import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type MembershipPlanResponse = components['schemas']['MembershipPlanResponseDto'];
export type CreateMembershipPlanInput = components['schemas']['CreateMembershipPlanDto'];
export type UpdateMembershipPlanInput = components['schemas']['UpdateMembershipPlanDto'];

/** No pagination in this UI yet — same established convention as
 * useBranches/useDisciplines/useInstructors/useClasses (see their own header
 * comments). */
export function useMembershipPlans(schoolId: string | null) {
  return useQuery({
    queryKey: ['membershipPlans', schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/membership-plans', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
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
