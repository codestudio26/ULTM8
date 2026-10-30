import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type MemberCharges = components['schemas']['MemberChargesResponseDto'];
export type MemberChargeSchool = components['schemas']['MemberChargeSchoolDto'];
export type Charge = components['schemas']['ChargeResponseDto'];
export type ChargePayment = components['schemas']['ChargePaymentResponseDto'];
export type ChargeBalance = components['schemas']['ChargeBalanceDto'];

/** GET /students/{id}/charges — the student's invoices and desk receipts at
 * every School (Decisions 303, 338), for the student or a Guardian. Read-only
 * for now: paying in the app is a later step. */
export function useMemberCharges(studentId: string | null) {
  return useQuery({
    queryKey: ['member-charges', studentId],
    queryFn: () => unwrap(apiClient.GET('/v1/students/{id}/charges', { params: { path: { id: studentId! } } })),
    enabled: !!studentId,
  });
}
