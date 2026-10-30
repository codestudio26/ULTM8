import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type MemberCharges = components['schemas']['MemberChargesResponseDto'];
export type MemberChargeSchool = components['schemas']['MemberChargeSchoolDto'];
export type Charge = components['schemas']['ChargeResponseDto'];
export type ChargePayment = components['schemas']['ChargePaymentResponseDto'];
export type ChargeBalance = components['schemas']['ChargeBalanceDto'];

/** GET /students/{id}/charges — the student's invoices and receipts at every
 * School (Decisions 303, 338), for the student or a Guardian, with what
 * paying in the app offers at each School (backlog §3.6 step 2). */
export function useMemberCharges(studentId: string | null) {
  return useQuery({
    queryKey: ['member-charges', studentId],
    queryFn: () => unwrap(apiClient.GET('/v1/students/{id}/charges', { params: { path: { id: studentId! } } })),
    enabled: !!studentId,
  });
}

export type MemberRecurringCharge = components['schemas']['MemberRecurringChargeDto'];

/** GET /students/{id}/recurring-charges — the recurring charges the School set
 * up for the student (Decision 412), read-only. */
export function useMemberRecurringCharges(studentId: string | null) {
  return useQuery({
    queryKey: ['member-recurring-charges', studentId],
    queryFn: () => unwrap(apiClient.GET('/v1/students/{id}/recurring-charges', { params: { path: { id: studentId! } } })),
    enabled: !!studentId,
  });
}

/** Re-reads the charges after a Checkout: the payment lands from Stripe's
 * webhook, so it may show as Pending for a moment first. */
export function useInvalidateMemberCharges() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['member-charges'] }),
      // A payment can pay a promotion fee, which then shows Paid (backlog §3.6 step 6).
      queryClient.invalidateQueries({ queryKey: ['my-fee-requests'] }),
      queryClient.invalidateQueries({ queryKey: ['grading-overview'] }),
    ]);
}

/** POST /students/{id}/charges/checkout — a hosted Stripe Checkout for one
 * charge (`chargeId`) or the whole balance (Decision 303 item 4). */
export function useStartChargeCheckout() {
  return useMutation({
    mutationFn: ({ studentId, schoolId, chargeId, currency }: { studentId: string; schoolId: string; chargeId?: string; currency?: string }) =>
      unwrap(
        apiClient.POST('/v1/students/{id}/charges/checkout', {
          params: { path: { id: studentId } },
          body: { schoolId, ...(chargeId ? { chargeId } : {}), ...(currency ? { currency } : {}) },
        }),
      ),
  });
}

/** PUT /students/{id}/charge-auto-pay — "Pay charges automatically with my
 * saved card" (Decision 338 item 8). Turning it on sends the step-up token
 * (Decision 239's X-Step-Up-Token header). */
export function useSetChargeAutoPay() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ studentId, schoolId, enabled, stepUpToken }: { studentId: string; schoolId: string; enabled: boolean; stepUpToken?: string }) =>
      unwrap(
        apiClient.PUT('/v1/students/{id}/charge-auto-pay', {
          params: { path: { id: studentId } },
          body: { schoolId, enabled },
          headers: stepUpToken ? { 'X-Step-Up-Token': stepUpToken } : undefined,
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['member-charges'] }),
  });
}
