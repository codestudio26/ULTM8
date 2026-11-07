import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';

/** The School's payment account, or `null` when it has none yet (the API
 * answers 404). */
export function useSchoolPaymentAccount(schoolId: string) {
  return useQuery({
    queryKey: ['school-payment-account', schoolId],
    queryFn: async () => {
      try {
        return await unwrap(apiClient.GET('/v1/schools/{schoolId}/payment-account', { params: { path: { schoolId } } }));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
  });
}

/** Decision 441 item 6 — Connected / Action needed / Not connected, read live
 * from Stripe (the API saves it for the setup checklist). School owners, and
 * Branch Staff with "Connect Stripe" (Decision 442 item 3). */
export function useSchoolConnectStatus(schoolId: string) {
  return useQuery({
    queryKey: ['school-connect-status', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/payment-account/connect-status', { params: { path: { schoolId } } })),
  });
}

/** Decision 441 item 6 — "Connect Stripe": creates the School's Stripe payment
 * account the first time (with the country the owner chose), then asks for a
 * Stripe onboarding link, using the existing endpoints (the same steps as the
 * Franchise's, Decision 407). Resolves to the URL to send the browser to. */
export function useConnectSchoolStripe(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ paymentAccountId, accountTitle, country }: { paymentAccountId: string | null; accountTitle: string; country: string }) => {
      const id =
        paymentAccountId ??
        (
          await unwrap(
            apiClient.POST('/v1/schools/{schoolId}/payment-accounts', {
              params: { path: { schoolId } },
              body: { provider: 'STRIPE', accountTitle, country },
            }),
          )
        ).id;
      const { onboardingUrl } = await unwrap(apiClient.POST('/v1/payment-accounts/{id}/connect/onboard', { params: { path: { id } } }));
      return onboardingUrl;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['school-payment-account', schoolId] });
      queryClient.invalidateQueries({ queryKey: ['school-connect-status', schoolId] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-overview', schoolId] });
    },
  });
}
