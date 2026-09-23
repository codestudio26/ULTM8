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
