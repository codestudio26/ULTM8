import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type FranchiseResponse = components['schemas']['FranchiseResponseDto'];

/** GET /platform-admin/franchises/:id — same look-up-by-known-id shape as
 * schoolQueries.ts's useSchool (see that file's own header comment); no
 * cross-tenant "list all Franchises" endpoint exists here either. */
export function useFranchise(franchiseId: string | null) {
  return useQuery({
    queryKey: ['platform-admin-franchise', franchiseId],
    queryFn: () => unwrap(apiClient.GET('/v1/platform-admin/franchises/{id}', { params: { path: { id: franchiseId! } } })),
    enabled: !!franchiseId,
    retry: false,
  });
}

/** GET /platform-admin/franchises/:franchiseId/payment-account — same
 * BILLING_PAYMENTS_OPS/FULL_ADMIN-only gate as the School version. */
export function useFranchisePaymentAccount(franchiseId: string | null) {
  return useQuery({
    queryKey: ['platform-admin-franchise-payment-account', franchiseId],
    queryFn: () =>
      unwrap(
        apiClient.GET('/v1/platform-admin/franchises/{franchiseId}/payment-account', {
          params: { path: { franchiseId: franchiseId! } },
        }),
      ),
    enabled: !!franchiseId,
    retry: false,
  });
}
