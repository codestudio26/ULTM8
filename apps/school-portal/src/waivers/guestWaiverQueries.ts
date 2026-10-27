import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type GuestWaiverPage = components['schemas']['GuestWaiverPageDto'];
export type SignGuestWaivers = components['schemas']['SignGuestWaiversDto'];
export type ClassGuestWaivers = components['schemas']['ClassGuestWaiversDto'];
export type BookingGuests = components['schemas']['BookingGuestsDto'];
export type GuestWaiverSignature = components['schemas']['GuestWaiverSignatureDto'];

/** The public guest signing page (Waivers Q9): the link is the only key. */
export function useGuestWaiverLink(token: string) {
  return useQuery({
    queryKey: ['guest-waiver-link', token],
    queryFn: () => unwrap(apiClient.GET('/v1/guest-waiver-links/{token}', { params: { path: { token } } })),
    retry: false,
  });
}

export function useSignGuestWaivers(token: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SignGuestWaivers) => unwrap(apiClient.POST('/v1/guest-waiver-links/{token}/sign', { params: { path: { token } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['guest-waiver-link', token] }),
  });
}

/** The class page: guests on Upcoming bookings and whether each has signed. */
export function useClassGuestWaivers(classId: string | undefined) {
  return useQuery({
    queryKey: ['class-guest-waivers', classId],
    queryFn: () => unwrap(apiClient.GET('/v1/classes/{id}/guest-waivers', { params: { path: { id: classId! } } })),
    enabled: !!classId,
  });
}

/** The Waivers page: guests who signed one waiver, newest first. Owner only. */
export function useGuestSignatures(schoolId: string, waiverId: string) {
  return useInfiniteQuery({
    queryKey: ['guest-waiver-signatures', schoolId, waiverId],
    queryFn: ({ pageParam }) =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/waivers/{id}/guest-signatures', {
          params: { path: { schoolId, id: waiverId }, query: pageParam ? { cursor: pageParam } : {} },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function useGuestSignature(schoolId: string, waiverId: string, signatureId: string | null) {
  return useQuery({
    queryKey: ['guest-waiver-signature', schoolId, waiverId, signatureId],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/waivers/{id}/guest-signatures/{signatureId}', {
          params: { path: { schoolId, id: waiverId, signatureId: signatureId! } },
        }),
      ),
    enabled: !!signatureId,
  });
}
