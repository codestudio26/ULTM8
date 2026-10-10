import React from 'react';
import type { UseMutationResult } from '@tanstack/react-query';
import { Badge, Button, ErrorBanner, SuccessBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { PlatformAdminPaymentAccountResponse, RotateCredentialResponse } from './paymentAccountQueries';

/** Shared between SchoolLookupPage and FranchiseLookupPage — both render this
 * exact same PaymentAccount detail block plus the "Rotate credential" action
 * (Phase 35). Extracted here rather than duplicated per entity type, same
 * reasoning paymentAccountQueries.ts's own header comment already gives. */
export function PaymentAccountDetails({
  account,
  rotateCredential,
}: {
  account: PlatformAdminPaymentAccountResponse;
  rotateCredential: UseMutationResult<RotateCredentialResponse, Error, string>;
}) {
  return (
    <>
      <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px' }}>
        <dt>Provider</dt>
        <dd>{account.provider}</dd>
        <dt>Account title</dt>
        <dd>{account.accountTitle}</dd>
        <dt>Country</dt>
        <dd>{account.country}</dd>
        <dt>Status</dt>
        <dd><Badge variant={account.status === 'ACTIVE' ? 'success' : 'default'}>{account.status}</Badge></dd>
        <dt>Mode</dt>
        <dd>{account.mode}</dd>
      </dl>

      {/* STRIPE-provider only, mirroring the backend's own gate — a
          CASH/BANK_TRANSFER account has no Stripe credential to rotate, and
          the server would 400 anyway if clicked. Not pre-validated further
          client-side (e.g. whether onboarding has actually completed) — the
          server's own error message surfaces that case directly. */}
      {account.provider === 'STRIPE' ? (
        <div style={{ marginTop: 16 }}>
          <Button variant="secondary" loading={rotateCredential.isPending} onClick={() => rotateCredential.mutate(account.id)}>
            Rotate credential
          </Button>
          {rotateCredential.isError ? (
            <div style={{ marginTop: 8 }}>
              <ErrorBanner
                message={rotateCredential.error instanceof ApiError ? rotateCredential.error.message : 'Could not initiate credential rotation.'}
              />
            </div>
          ) : null}
          {rotateCredential.isSuccess ? (
            <div style={{ marginTop: 8 }}>
              <SuccessBanner message="A fresh Stripe onboarding link was generated — relay it to the tenant so they can complete it (Stripe collects their own business/banking details; this isn't something Platform Admin fills in on their behalf)." />
              <p style={{ marginTop: 8, wordBreak: 'break-all' }}>
                <a href={rotateCredential.data.onboardingUrl} target="_blank" rel="noreferrer">
                  {rotateCredential.data.onboardingUrl}
                </a>
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
