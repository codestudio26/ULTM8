import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap, type components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type PaymentMethodStatus = components['schemas']['PaymentMethodResponseDto'];

/** GET /schools/{schoolId}/payment-methods/me — Decision 234's own
 * saved-payment-method dependency. Scoped per School, not globally per
 * Student (StudentPaymentMethod's own schema.prisma comment: a Stripe
 * Customer lives inside exactly one connected account, Decision 86). */
export function usePaymentMethod(schoolId: string | null) {
  return useQuery({
    queryKey: ['payment-method', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/payment-methods/me', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

/** Same `useQueries`-per-enrolled-School shape `useAllEnrolledSchoolWaivers`
 * (waiverQueries.ts) already established — a multi-School Student has one
 * saved-card status per School, not one merged value. */
export function usePaymentMethodsForSchools(schoolIds: string[]) {
  return useQueries({
    queries: schoolIds.map((schoolId) => ({
      queryKey: ['payment-method', schoolId],
      queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/payment-methods/me', { params: { path: { schoolId } } })),
    })),
  });
}

/** POST .../payment-methods/setup-session — returns a hosted Stripe Checkout
 * URL to open (PaymentMethodsScreen's own header comment has the full
 * "hosted Checkout, not an embedded SDK" account). Does not itself know when
 * the Student finishes the hosted flow — the caller refetches
 * usePaymentMethod() after the browser closes. */
export function useCreateSetupSession(schoolId: string) {
  return useMutation({
    mutationFn: () => unwrap(apiClient.POST('/v1/schools/{schoolId}/payment-methods/setup-session', { params: { path: { schoolId } } })),
  });
}

export function useDeletePaymentMethod(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unwrap(apiClient.DELETE('/v1/schools/{schoolId}/payment-methods/me', { params: { path: { schoolId } } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['payment-method', schoolId] }),
  });
}
