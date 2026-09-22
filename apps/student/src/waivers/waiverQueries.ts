import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

type Waiver = components['schemas']['WaiverResponseDto'];

/** GET /schools/{schoolId}/waivers, once per enrolled School — a Student can hold a
 * STUDENT RoleGrant at more than one School (SKILL.md §6.1/§8.3), and every one of
 * them can have its own Waivers to sign, not just whichever School happened to be
 * first. `useQueries` (not N individual `useInfiniteQuery` calls, which the Rules
 * of Hooks forbid for a dynamic-length list anyway) — same "wide single page,
 * accept the small edge-case gap, documented explicitly" precedent already
 * established by `useMyWaiverSignatures` below, since merging N independently
 * cursor-paginated lists into one scrollable view has no clean "next page" meaning
 * and a School realistically has far fewer than 100 Waivers. Each returned Waiver
 * is tagged with the School it came from — the response DTO doesn't carry it, since
 * it's implied by the path param for a single-School fetch. */
export function useAllEnrolledSchoolWaivers(schoolIds: string[]) {
  const results = useQueries({
    queries: schoolIds.map((schoolId) => ({
      queryKey: ['school-waivers-all', schoolId],
      queryFn: () =>
        unwrap(
          apiClient.GET('/v1/schools/{schoolId}/waivers', {
            params: { path: { schoolId }, query: { limit: 100 } },
          }),
        ),
    })),
  });

  const items: (Waiver & { schoolId: string })[] = [];
  results.forEach((r, i) => {
    if (r.data) items.push(...r.data.items.map((w) => ({ ...w, schoolId: schoolIds[i] })));
  });

  return {
    items,
    isLoading: results.some((r) => r.isLoading),
    isError: results.some((r) => r.isError),
    error: results.find((r) => r.isError)?.error,
  };
}

/** Confirmed via apps/api/src/academies (academyId IS schoolId — AcademiesService.
 * findOne(schoolId) looks up the School row directly): reuses `['academy', schoolId]`,
 * the exact query key `academyQueries.ts`'s `useAcademy` already uses, so a School
 * name already cached from browsing AcademyDetailScreen is reused here for free, and
 * this call populates that same cache for later too — not a coincidence, a
 * deliberate shared key. Only used for a display label; unlike the Waivers/
 * signatures gate above, this app doesn't block rendering on it settling — a
 * momentary schoolId fallback while a name resolves is a display nicety, not a
 * correctness risk the way an unresolved sign-status gate would be. */
export function useEnrolledSchoolNames(schoolIds: string[]) {
  const results = useQueries({
    queries: schoolIds.map((schoolId) => ({
      queryKey: ['academy', schoolId],
      queryFn: () => unwrap(apiClient.GET('/v1/academies/{id}', { params: { path: { id: schoolId } } })),
    })),
  });

  const nameById = new Map<string, string>();
  results.forEach((r, i) => {
    if (r.data) nameById.set(schoolIds[i], r.data.name);
  });
  return nameById;
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
