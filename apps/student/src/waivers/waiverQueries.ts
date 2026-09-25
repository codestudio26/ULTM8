import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';

/** GET /schools/{schoolId}/waivers — every Waiver defined for the Student's own
 * enrolled School (resolved from their JWT `grants`, not a new endpoint). Only
 * reachable for a School the caller already holds a RoleGrant at — a browsing,
 * not-yet-enrolled Student (Slice 1's Discovery flow) has no waivers to sign
 * anywhere yet, so this screen is only ever entered from an enrolled context. */
export function useSchoolWaivers(schoolId: string | null) {
  return useInfiniteQuery({
    queryKey: ['school-waivers', schoolId],
    queryFn: ({ pageParam }: { pageParam?: string }) =>
      unwrap(
        apiClient.GET('/v1/schools/{schoolId}/waivers', {
          params: { path: { schoolId: schoolId! }, query: { cursor: pageParam } },
        }),
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: !!schoolId,
  });
}

/** GET /waivers/me — the Student's own signatures, used only to know which
 * Waivers are already signed. Requested at the max page size (100 — see
 * PaginationQueryDto) as a single page rather than draining every cursor page,
 * since a Student realistically never approaches 100 signed Waivers; this covers
 * that with a wide margin without the complexity of a full drain. */
export function useMyWaiverSignatures(enabled: boolean) {
  return useQuery({
    queryKey: ['my-waiver-signatures'],
    queryFn: () => unwrap(apiClient.GET('/v1/waivers/me', { params: { query: { limit: 100 } } })),
    enabled,
  });
}

/** POST /waivers/{id}/sign — typed name + typed signature text only (Spec 55's
 * confirmed baseline mechanism; see SignWaiverDto's own header comment — drawn/
 * canvas signature capture isn't part of the confirmed contract yet). */
export function useSignWaiver() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ waiverId, signerFullName, signatureText }: { waiverId: string; signerFullName: string; signatureText: string }) =>
      unwrap(
        apiClient.POST('/v1/waivers/{id}/sign', {
          params: { path: { id: waiverId } },
          body: { signerFullName, signatureText },
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['my-waiver-signatures'] }),
  });
}
