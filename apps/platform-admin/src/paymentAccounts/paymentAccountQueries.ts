import { useMutation, useQueryClient } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';

export type RotateCredentialResponse = components['schemas']['RotateCredentialResponseDto'];
/** Shared between schoolQueries.ts and franchiseQueries.ts — both GET
 * .../payment-account routes return this exact same shape (see
 * PlatformAdminPaymentAccountsController's own header comment for why one
 * response DTO serves both). Defined once here rather than duplicated per
 * entity type. */
export type PlatformAdminPaymentAccountResponse = components['schemas']['PlatformAdminPaymentAccountResponseDto'];

/** POST /platform-admin/payment-accounts/:id/rotate-credential — shared between
 * SchoolLookupPage and FranchiseLookupPage (both render a PaymentAccount
 * section), so this lives in its own paymentAccounts/ folder rather than
 * duplicated per entity type or bolted onto one arbitrarily. Takes the
 * PaymentAccount's own id directly, not a school/franchise-scoped path — same
 * shape the backend route itself uses (see
 * PlatformAdminPaymentAccountsController's own comment for why). The server
 * rejects (400) a non-STRIPE account or one that never completed onboarding —
 * this hook doesn't try to predict that client-side, same reasoning
 * useRevokeAdminUser's own comment already gives for not pre-validating a
 * server-side business rule. */
export function useRotateCredential() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (paymentAccountId: string) =>
      unwrap(apiClient.POST('/v1/platform-admin/payment-accounts/{id}/rotate-credential', { params: { path: { id: paymentAccountId } } })),
    onSuccess: () => {
      // Not strictly necessary today (the rotation doesn't change any field the
      // PaymentAccount read queries render), but matches this app's own
      // established convention of invalidating what a write plausibly affects,
      // not just what it's currently known to.
      queryClient.invalidateQueries({ queryKey: ['platform-admin-school-payment-account'] });
      queryClient.invalidateQueries({ queryKey: ['platform-admin-franchise-payment-account'] });
    },
  });
}
