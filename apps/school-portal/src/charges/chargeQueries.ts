import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

/** Staff-created charges and the member balance (Decisions 303, 338, 411). */
export type Charge = components['schemas']['ChargeResponseDto'];
export type ChargePayment = components['schemas']['ChargePaymentResponseDto'];
export type ChargeBalance = components['schemas']['ChargeBalanceDto'];
export type StudentCharges = components['schemas']['StudentChargesResponseDto'];
export type CreateChargeInput = components['schemas']['CreateChargeDto'];
export type RecordChargePaymentInput = components['schemas']['RecordChargePaymentDto'];
export type ChargePermission = components['schemas']['ChargePermissionDto'];
export type StandardTaxRate = components['schemas']['StandardTaxRateDto'];

export const CHARGE_PAYMENT_METHODS = ['CASH', 'PIX', 'BANK_TRANSFER', 'CARD_TERMINAL'] as const satisfies readonly RecordChargePaymentInput['paymentMethod'][];

const key = (schoolId: string | null, studentId: string) => ['charges', schoolId, studentId];

/** A student's charges, desk payments and balance. A 403 means the caller
 * may not see them (no charges switch), so the card stays hidden. */
export function useStudentCharges(schoolId: string | null, studentId: string) {
  return useQuery({
    queryKey: key(schoolId, studentId),
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/students/{studentId}/charges', { params: { path: { schoolId: schoolId!, studentId } } })),
    enabled: !!schoolId && !!studentId,
    retry: false,
  });
}

function useInvalidateCharges(schoolId: string | null, studentId: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['transactions'] });
    // A payment can pay a promotion fee, which then shows Paid in grading and
    // may apply a waiting promotion (backlog §3.6 step 6).
    void queryClient.invalidateQueries({ queryKey: ['student-grading'] });
    void queryClient.invalidateQueries({ queryKey: ['grading-board'] });
    return queryClient.invalidateQueries({ queryKey: key(schoolId, studentId) });
  };
}

export function useCreateCharge(schoolId: string | null, studentId: string) {
  const invalidate = useInvalidateCharges(schoolId, studentId);
  return useMutation({
    mutationFn: (body: CreateChargeInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/students/{studentId}/charges', { params: { path: { schoolId: schoolId!, studentId } }, body })),
    onSuccess: invalidate,
  });
}

export function useRecordChargePayment(schoolId: string | null, studentId: string) {
  const invalidate = useInvalidateCharges(schoolId, studentId);
  return useMutation({
    mutationFn: (body: RecordChargePaymentInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/students/{studentId}/charge-payments', { params: { path: { schoolId: schoolId!, studentId } }, body })),
    onSuccess: invalidate,
  });
}

export function useCancelCharge(schoolId: string | null, studentId: string) {
  const invalidate = useInvalidateCharges(schoolId, studentId);
  return useMutation({
    mutationFn: ({ chargeId, reason }: { chargeId: string; reason: string }) =>
      unwrap(
        apiClient.POST('/v1/schools/{schoolId}/charges/{chargeId}/cancel', {
          params: { path: { schoolId: schoolId!, chargeId } },
          body: reason ? { reason } : {},
        }),
      ),
    onSuccess: invalidate,
  });
}

/** Recurring charges (Decision 412; backlog §3.6 step 3). */
export type RecurringCharge = components['schemas']['RecurringChargeResponseDto'];
export type StudentRecurringCharges = components['schemas']['StudentRecurringChargesResponseDto'];
export type CreateRecurringChargeInput = components['schemas']['CreateRecurringChargeDto'];

const recurringKey = (schoolId: string | null, studentId: string) => ['recurring-charges', schoolId, studentId];

/** A student's recurring charges. A 403 means the caller may not see them. */
export function useStudentRecurringCharges(schoolId: string | null, studentId: string) {
  return useQuery({
    queryKey: recurringKey(schoolId, studentId),
    queryFn: () =>
      unwrap(apiClient.GET('/v1/schools/{schoolId}/students/{studentId}/recurring-charges', { params: { path: { schoolId: schoolId!, studentId } } })),
    enabled: !!schoolId && !!studentId,
    retry: false,
  });
}

/** Setting up, stopping or restarting a series can make a charge today, so
 * the charges are re-read too. */
function useInvalidateRecurring(schoolId: string | null, studentId: string) {
  const queryClient = useQueryClient();
  const invalidateCharges = useInvalidateCharges(schoolId, studentId);
  return () => {
    void invalidateCharges();
    return queryClient.invalidateQueries({ queryKey: recurringKey(schoolId, studentId) });
  };
}

export function useCreateRecurringCharge(schoolId: string | null, studentId: string) {
  const invalidate = useInvalidateRecurring(schoolId, studentId);
  return useMutation({
    mutationFn: (body: CreateRecurringChargeInput) =>
      unwrap(apiClient.POST('/v1/schools/{schoolId}/students/{studentId}/recurring-charges', { params: { path: { schoolId: schoolId!, studentId } }, body })),
    onSuccess: invalidate,
  });
}

export function useStopRecurringCharge(schoolId: string | null, studentId: string) {
  const invalidate = useInvalidateRecurring(schoolId, studentId);
  return useMutation({
    mutationFn: (id: string) => unwrap(apiClient.POST('/v1/schools/{schoolId}/recurring-charges/{id}/stop', { params: { path: { schoolId: schoolId!, id } } })),
    onSuccess: invalidate,
  });
}

export function useRestartRecurringCharge(schoolId: string | null, studentId: string) {
  const invalidate = useInvalidateRecurring(schoolId, studentId);
  return useMutation({
    mutationFn: (id: string) => unwrap(apiClient.POST('/v1/schools/{schoolId}/recurring-charges/{id}/restart', { params: { path: { schoolId: schoolId!, id } } })),
    onSuccess: invalidate,
  });
}

/** ULTM8's standard rate per country, for the School page's pre-fill (Decision 411). */
export function useStandardTaxRates() {
  return useQuery({
    queryKey: ['tax-rates'],
    queryFn: () => unwrap(apiClient.GET('/v1/tax-rates')),
    staleTime: Infinity,
  });
}

/** Owner only: who may create and cancel charges. */
export function useChargePermissions(schoolId: string | null) {
  return useQuery({
    queryKey: ['charge-permissions', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/charge-permissions', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

export function useSetChargePermission(schoolId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, canCreateCharges, canCancelCharges }: { userId: string; canCreateCharges: boolean; canCancelCharges: boolean }) =>
      unwrap(
        apiClient.PUT('/v1/schools/{schoolId}/charge-permissions/{userId}', {
          params: { path: { schoolId: schoolId!, userId } },
          body: { canCreateCharges, canCancelCharges },
        }),
      ),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['staff-activity'] });
      return queryClient.invalidateQueries({ queryKey: ['charge-permissions', schoolId] });
    },
  });
}

/** A rate in hundredths of a percent as the text a rate box shows: 2000 → "20", 810 → "8.1". */
export function rateText(basisPoints: number): string {
  return String(basisPoints / 100);
}

/** "20" / "8.10" / "0" → 2000 / 810 / 0; null when it isn't a rate from 0 to 100 with at most 2 decimals. */
export function parseRate(text: string): number | null {
  const t = text.trim().replace(',', '.');
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null;
  const [whole, frac = ''] = t.split('.');
  const bp = Number(whole) * 100 + Number(frac.padEnd(2, '0'));
  return bp <= 10000 ? bp : null;
}

/** The same sums the API makes (apps/api/src/charges/charge-maths.ts), for
 * the Create charge preview. The API's answer is the one kept. */
export function previewCharge(input: {
  amount: number;
  discountType: 'PERCENT' | 'FIXED' | null;
  discountValue: number | null;
  taxRateBasisPoints: number;
  taxInclusive: boolean;
}): { discount: number; net: number; tax: number; gross: number } | null {
  const round = (n: number, d: number) => Math.floor((2 * n + d) / (2 * d));
  if (!(input.amount > 0)) return null;
  let discount = 0;
  if (input.discountType && input.discountValue) {
    discount = input.discountType === 'PERCENT' ? round(input.amount * input.discountValue, 10000) : input.discountValue;
  }
  if (discount >= input.amount) return null;
  const price = input.amount - discount;
  if (input.taxInclusive) {
    const net = round(price * 10000, 10000 + input.taxRateBasisPoints);
    return { discount, net, tax: price - net, gross: price };
  }
  const tax = round(price * input.taxRateBasisPoints, 10000);
  return { discount, net: price, tax, gross: price + tax };
}
