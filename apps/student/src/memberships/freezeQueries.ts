import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

/** Decision 404: a membership the Student, or their child, may ask to freeze. */
export type FreezableMembership = components['schemas']['MyFreezableMembershipDto'];

/** GET /memberships/freezes/me — the caller's own memberships that can be
 * frozen, and their linked children's, each with its freeze or request. */
export function useMyFreezes() {
  return useQuery({
    queryKey: ['my-freezes'],
    queryFn: () => unwrap(apiClient.GET('/v1/memberships/freezes/me')),
  });
}

function useInvalidate() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: ['my-freezes'] }), queryClient.invalidateQueries({ queryKey: ['my-memberships'] })]);
}

/** Ask the School to freeze a membership (the member, or a Guardian for a child). */
export function useRequestFreeze() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ membershipId, startsAt, endsAt }: { membershipId: string; startsAt: string; endsAt: string }) =>
      unwrap(apiClient.POST('/v1/memberships/{membershipId}/freeze-requests', { params: { path: { membershipId } }, body: { startsAt, endsAt } })),
    onSuccess: invalidate,
  });
}

/** Withdraw a request nobody has decided yet, or end an approved freeze early. */
export function useFreezeAction() {
  const invalidate = useInvalidate();
  return useMutation({
    mutationFn: ({ freezeId, action }: { freezeId: string; action: 'cancel' | 'end' }) =>
      action === 'cancel'
        ? unwrap(apiClient.POST('/v1/freezes/{id}/cancel', { params: { path: { id: freezeId } } }))
        : unwrap(apiClient.POST('/v1/freezes/{id}/end', { params: { path: { id: freezeId } } })),
    onSuccess: invalidate,
  });
}

/** A YYYY-MM-DD day `offset` days after `day`. */
export function addDays(day: string, offset: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}
