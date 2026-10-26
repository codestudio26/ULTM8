import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type FranchiseResponse = components['schemas']['FranchiseResponseDto'];
export type CreateFranchiseInput = components['schemas']['CreateFranchiseDto'];
export type UpdateFranchiseInput = components['schemas']['UpdateFranchiseDto'];
export type FranchiseFeeChargeResponse = components['schemas']['FranchiseFeeChargeResponseDto'];
export type FranchiseMemberSchool = components['schemas']['FranchiseMemberSchoolResponseDto'];
export type FeeModel = components['schemas']['FranchiseResponseDto']['feeModel'];

export interface FranchisesFilter {
  feeModel?: FeeModel;
  activity?: string;
}

/** Every Franchise the caller owns — GET /franchises is already scoped this way
 * server-side (franchise_tenant_isolation RLS restricts it to the caller's own
 * FRANCHISE_OWNER grants, see FranchisesService.findAllForCaller's own header
 * comment), so this is never a School-wide or platform-wide list. No
 * pagination in this UI yet — same established convention as
 * useBranches/useDisciplines/useInstructors.
 *
 * `filter.feeModel`/`filter.activity` — additive, optional server-side filters
 * (Franchises page's Fee model / Activity filters, now wired to the real
 * GET /franchises?feeModel=&activity= query params instead of filtering an
 * already-fetched list client-side). Both omitted behaves exactly as before
 * either filter existed. */
export function useFranchises(filter: FranchisesFilter = {}) {
  return useQuery({
    queryKey: ['franchises', filter.feeModel ?? null, filter.activity ?? null],
    queryFn: () =>
      unwrap(apiClient.GET('/v1/franchises', { params: { query: { feeModel: filter.feeModel, activity: filter.activity } } })),
  });
}

/** Single-Franchise fetch — for the Franchise detail page (School roster + fee
 * billing), which needs the Franchise's own fields without re-fetching the
 * whole list. */
export function useFranchise(franchiseId: string | null) {
  return useQuery({
    queryKey: ['franchise', franchiseId],
    queryFn: () => unwrap(apiClient.GET('/v1/franchises/{id}', { params: { path: { id: franchiseId! } } })),
    enabled: !!franchiseId,
  });
}

/** Decision 99's own follow-up — lets FranchiseFormModal know, BEFORE
 * submitting a rate change, whether feeRateChangeStrategy will be required
 * (same "query, don't guess" shape useMembershipPlanActiveCount already
 * establishes for its own price-change prompt). Only enabled while editing an
 * existing Franchise — a brand-new one has no Schools yet. */
export function useFranchiseBillingStatus(franchiseId: string | null) {
  return useQuery({
    queryKey: ['franchise-billing-status', franchiseId],
    queryFn: () => unwrap(apiClient.GET('/v1/franchises/{id}/billing-status', { params: { path: { id: franchiseId! } } })),
    enabled: !!franchiseId,
  });
}

export function useCreateFranchise() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateFranchiseInput) => unwrap(apiClient.POST('/v1/franchises', { body })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['franchises'] }),
  });
}

export function useUpdateFranchise(franchiseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateFranchiseInput) =>
      unwrap(apiClient.PATCH('/v1/franchises/{id}', { params: { path: { id: franchiseId } }, body })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['franchises'] });
      queryClient.invalidateQueries({ queryKey: ['franchise', franchiseId] });
    },
  });
}

/** A Franchise's own member-School roster (Franchise Owner-only, purpose-built
 * cross-tenant read — see FranchisesService.findSchoolsForFranchise's own
 * header comment). Not cursor-paginated server-side either (a bounded
 * administrative view), matching this hook to that shape 1:1. */
export function useFranchiseSchools(franchiseId: string | null) {
  return useQuery({
    queryKey: ['franchise-schools', franchiseId],
    queryFn: () => unwrap(apiClient.GET('/v1/franchises/{id}/schools', { params: { path: { id: franchiseId! } } })),
    enabled: !!franchiseId,
  });
}

/** A Franchise's own fee-charge history — read-only ledger, no pagination in
 * this UI yet (matches every other list screen's own current scope). */
export function useFranchiseFeeCharges(franchiseId: string | null) {
  return useQuery({
    queryKey: ['franchise-fee-charges', franchiseId],
    queryFn: () => unwrap(apiClient.GET('/v1/franchises/{id}/fee-charges', { params: { path: { id: franchiseId! } } })),
    enabled: !!franchiseId,
  });
}

/** Refunds a fee charge (full remaining balance if `amount` is omitted — see
 * RefundFranchiseFeeChargeDto's own comment). Franchise Owner-only,
 * server-enforced (FranchiseFeesService.refund()). */
export function useRefundFeeCharge(franchiseId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ chargeId, amount }: { chargeId: string; amount?: number }) =>
      unwrap(
        apiClient.POST('/v1/franchise-fee-charges/{id}/refund', {
          params: { path: { id: chargeId } },
          body: amount ? { amount } : {},
        }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['franchise-fee-charges', franchiseId] }),
  });
}

/** Decision 336 (F7) — whether the Franchise has a Stripe account franchise-fee
 * billing can run on. `null` when it has none yet (the API answers 404); the
 * Franchise page uses this to explain why member Schools stay "Not billing yet". */
export function useFranchisePaymentAccount(franchiseId: string | null) {
  return useQuery({
    queryKey: ['franchise-payment-account', franchiseId],
    queryFn: async () => {
      try {
        return await unwrap(apiClient.GET('/v1/franchises/{franchiseId}/payment-account', { params: { path: { franchiseId: franchiseId! } } }));
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) return null;
        throw err;
      }
    },
    enabled: !!franchiseId,
  });
}
