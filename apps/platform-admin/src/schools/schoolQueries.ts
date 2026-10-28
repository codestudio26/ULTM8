import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type SchoolResponse = components['schemas']['SchoolResponseDto'];

/** GET /platform-admin/schools/:id — no cross-tenant "list all Schools" endpoint
 * exists (PlatformAdminSchoolsService is deliberately findOne-by-id only, see
 * that service's own header comment), so this is a look-up-by-known-id screen,
 * same shape apps/school-portal's own StaffPage already established for "look
 * up one known user's role grants." Every successful call is audit-logged
 * server-side (VIEW_SCHOOL) regardless of what this screen does with the
 * result — not duplicated client-side. */
export function useSchool(schoolId: string | null) {
  return useQuery({
    queryKey: ['platform-admin-school', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/platform-admin/schools/{id}', { params: { path: { id: schoolId! } } })),
    enabled: !!schoolId,
    retry: false, // a 404 (School not found) shouldn't retry into a slow spinner
  });
}

/** GET /platform-admin/schools/:schoolId/payment-account — BILLING_PAYMENTS_OPS/
 * FULL_ADMIN only server-side (assertBillingOrFullAdmin); a SUPPORT caller gets
 * this screen's own error state (403), not a silently empty section. 404 means
 * no PaymentAccount configured for this School yet — a normal state, not an
 * error (see SchoolLookupPage's own handling). */
export function useSchoolPaymentAccount(schoolId: string | null) {
  return useQuery({
    queryKey: ['platform-admin-school-payment-account', schoolId],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/platform-admin/schools/{schoolId}/payment-account', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
    retry: false,
  });
}

/** GET /platform-admin/schools/:id/owners (Decision 370) — the School's
 * owners, main owner first. Audit-logged server-side (VIEW_SCHOOL_OWNERS). */
export function useSchoolOwners(schoolId: string | null) {
  return useQuery({
    queryKey: ['platform-admin-school-owners', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/platform-admin/schools/{id}/owners', { params: { path: { id: schoolId! } } })),
    enabled: !!schoolId,
    retry: false,
  });
}

/** POST /platform-admin/schools/:id/main-owner (Decision 370) — FULL_ADMIN
 * only server-side: moves the main owner role to a co-owner, optionally
 * ending the former main owner's owner role. */
export function useChangeSchoolMainOwner(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { userId: string; removeFormerMainOwner: boolean }) =>
      unwrap(apiClient.POST('/v1/platform-admin/schools/{id}/main-owner', { params: { path: { id: schoolId } }, body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['platform-admin-school-owners', schoolId] }),
  });
}
