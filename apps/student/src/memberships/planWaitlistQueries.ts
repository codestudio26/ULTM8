import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type PlanAvailability = components['schemas']['PlanAvailabilityItemDto'];

/** Decision 435 items 10-15: the School's plans with a member limit, whether
 * each is full for this member (a parent passes their child), and their place
 * on its waiting list. Only asked once the person is a member there. */
export function usePlanAvailability(schoolId: string | null, studentId?: string, enabled = true) {
  return useQuery({
    queryKey: ['plan-availability', schoolId, studentId ?? null],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/plan-availability', {
          params: { path: { schoolId: schoolId! }, query: studentId ? { studentId } : {} },
        }),
      ),
    enabled: !!schoolId && enabled,
  });
}

/** Join or leave a full plan's waiting list (item 14: a parent for their child). */
export function usePlanWaitlist() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['plan-availability'] });
  return {
    join: useMutation({
      mutationFn: ({ planId, studentId }: { planId: string; studentId?: string }) =>
        unwrap(apiClient.POST('/v1/membership-plans/{id}/waitlist', { params: { path: { id: planId } }, body: studentId ? { studentId } : {} })),
      onSuccess: refresh,
    }),
    leave: useMutation({
      mutationFn: ({ planId, studentId }: { planId: string; studentId?: string }) =>
        unwrap(apiClient.DELETE('/v1/membership-plans/{id}/waitlist', { params: { path: { id: planId }, query: studentId ? { studentId } : {} } })),
      onSuccess: refresh,
    }),
  };
}
