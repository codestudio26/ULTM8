import React, { useState } from 'react';
import { Badge, Button, Card, ErrorBanner, Field, PageHeader, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useFranchise, useFranchisePaymentAccount } from './franchiseQueries';
import { useRotateCredential } from '../paymentAccounts/paymentAccountQueries';
import { PaymentAccountDetails } from '../paymentAccounts/PaymentAccountDetails';

/** Look-up-by-id — see franchiseQueries.ts's own header comment for why
 * there's no list here. Mostly read-only, same scope reasoning as
 * SchoolLookupPage's own header comment — including the same "Rotate
 * credential" write on the PaymentAccount section (Phase 35). */
export function FranchiseLookupPage() {
  const [idInput, setIdInput] = useState('');
  const [lookedUpId, setLookedUpId] = useState<string | null>(null);

  const franchise = useFranchise(lookedUpId);
  const paymentAccount = useFranchisePaymentAccount(lookedUpId);
  const rotateCredential = useRotateCredential();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLookedUpId(idInput.trim() || null);
  }

  return (
    <>
      <PageHeader title="Look up a Franchise" subtitle="Cross-tenant read, audited on every successful lookup." />
      <Card>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
          <Field label="Franchise ID" htmlFor="franchise-id-input">
            <TextField id="franchise-id-input" required value={idInput} onChange={(e) => setIdInput(e.target.value)} />
          </Field>
          <Button type="submit">Look up</Button>
        </form>
      </Card>

      {lookedUpId ? (
        <>
          {franchise.isLoading ? <Spinner /> : null}
          {franchise.error ? (
            <ErrorBanner
              message={
                franchise.error instanceof ApiError && franchise.error.status === 404
                  ? 'No Franchise found with that ID.'
                  : franchise.error instanceof ApiError
                    ? franchise.error.message
                    : 'Could not load this Franchise.'
              }
            />
          ) : null}
          {franchise.data ? (
            <Card>
              <p className="ultm8-subcard-title">{franchise.data.name}</p>
              <dl className="ultm8-info-grid">
                <dt>Address</dt>
                <dd>{franchise.data.address ?? '—'}</dd>
                <dt>Mobile</dt>
                <dd>{franchise.data.mobileNumber ?? '—'}</dd>
                <dt>Activities</dt>
                <dd>{franchise.data.activities.map((a, i) => <Badge key={`${a}-${i}`}>{a}</Badge>)}</dd>
                <dt>Fee model</dt>
                <dd>{franchise.data.feeModel === 'FLAT' ? 'Flat' : 'Per-headcount'}</dd>
                <dt>Created</dt>
                <dd>{new Date(franchise.data.createdAt).toLocaleString()}</dd>
              </dl>
            </Card>
          ) : null}

          {franchise.data ? (
            <Card>
              <p className="ultm8-subcard-title">Payment account</p>
              {paymentAccount.isLoading ? <Spinner /> : null}
              {paymentAccount.error instanceof ApiError && paymentAccount.error.status === 404 ? (
                <p>No payment account configured for this Franchise.</p>
              ) : paymentAccount.error instanceof ApiError && paymentAccount.error.status === 403 ? (
                <ErrorBanner message="Your account tier (Support) cannot view payment account configuration." />
              ) : paymentAccount.error ? (
                <ErrorBanner message="Could not load the payment account." />
              ) : paymentAccount.data ? (
                <PaymentAccountDetails account={paymentAccount.data} rotateCredential={rotateCredential} />
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}
