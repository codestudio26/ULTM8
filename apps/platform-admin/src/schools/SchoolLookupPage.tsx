import React, { useState } from 'react';
import { Badge, Button, Card, ErrorBanner, Field, PageHeader, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useSchool, useSchoolPaymentAccount } from './schoolQueries';

/** Look-up-by-id — see schoolQueries.ts's own header comment for why there's no
 * list here. Read-only (Slice 7): no edit/create UI, since PlatformAdminModule
 * has no write endpoint for School fields themselves — only a School Owner can
 * edit their own School (apps/school-portal), and Platform Admin's own write
 * surface for tenant data (credential rotation, impersonation) is a separate,
 * not-yet-built slice (see this app's own README). */
export function SchoolLookupPage() {
  const [idInput, setIdInput] = useState('');
  const [lookedUpId, setLookedUpId] = useState<string | null>(null);

  const school = useSchool(lookedUpId);
  const paymentAccount = useSchoolPaymentAccount(lookedUpId);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLookedUpId(idInput.trim() || null);
  }

  return (
    <>
      <PageHeader title="Look up a School" subtitle="Cross-tenant read, audited on every successful lookup." />
      <Card>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <Field label="School ID" htmlFor="school-id-input">
            <TextField id="school-id-input" required value={idInput} onChange={(e) => setIdInput(e.target.value)} />
          </Field>
          <Button type="submit">Look up</Button>
        </form>
      </Card>

      {lookedUpId ? (
        <>
          {school.isLoading ? <Spinner /> : null}
          {school.error ? (
            <ErrorBanner
              message={
                school.error instanceof ApiError && school.error.status === 404
                  ? 'No School found with that ID.'
                  : school.error instanceof ApiError
                    ? school.error.message
                    : 'Could not load this School.'
              }
            />
          ) : null}
          {school.data ? (
            <Card>
              <h3 style={{ marginTop: 0 }}>{school.data.name}</h3>
              <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px' }}>
                <dt>Franchise</dt>
                <dd>{school.data.franchiseId ?? <em>Independent — no Franchise</em>}</dd>
                <dt>Address</dt>
                <dd>{school.data.address ?? '—'}</dd>
                <dt>Mobile</dt>
                <dd>{school.data.mobileNumber ?? '—'}</dd>
                <dt>Activities</dt>
                <dd>{school.data.activities.map((a, i) => <Badge key={`${a}-${i}`}>{a}</Badge>)}</dd>
                <dt>Cancellation policy</dt>
                <dd>{school.data.classCancellationPolicy}</dd>
                <dt>Franchise fee status</dt>
                <dd>{school.data.franchiseFeeSubscriptionStatus ?? '—'}</dd>
                <dt>Created</dt>
                <dd>{new Date(school.data.createdAt).toLocaleString()}</dd>
              </dl>
            </Card>
          ) : null}

          {/* PaymentAccount is its own audited read (BILLING_PAYMENTS_OPS/
              FULL_ADMIN only) — only attempted once the School itself is
              confirmed to exist, so a School-not-found state doesn't also
              show a confusing "no payment account" message underneath it. */}
          {school.data ? (
            <Card>
              <h3 style={{ marginTop: 0 }}>Payment account</h3>
              {paymentAccount.isLoading ? <Spinner /> : null}
              {paymentAccount.error instanceof ApiError && paymentAccount.error.status === 404 ? (
                <p>No payment account configured for this School.</p>
              ) : paymentAccount.error instanceof ApiError && paymentAccount.error.status === 403 ? (
                <ErrorBanner message="Your account tier (Support) cannot view payment account configuration." />
              ) : paymentAccount.error ? (
                <ErrorBanner message="Could not load the payment account." />
              ) : paymentAccount.data ? (
                <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '4px 16px' }}>
                  <dt>Provider</dt>
                  <dd>{paymentAccount.data.provider}</dd>
                  <dt>Account title</dt>
                  <dd>{paymentAccount.data.accountTitle}</dd>
                  <dt>Country</dt>
                  <dd>{paymentAccount.data.country}</dd>
                  <dt>Status</dt>
                  <dd><Badge variant={paymentAccount.data.status === 'ACTIVE' ? 'success' : 'default'}>{paymentAccount.data.status}</Badge></dd>
                  <dt>Mode</dt>
                  <dd>{paymentAccount.data.mode}</dd>
                </dl>
              ) : null}
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}
