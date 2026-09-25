import React, { useState } from 'react';
import { Badge, Button, Card, ErrorBanner, Field, PageHeader, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useSchool, useSchoolPaymentAccount } from './schoolQueries';
import { useRotateCredential } from '../paymentAccounts/paymentAccountQueries';
import { PaymentAccountDetails } from '../paymentAccounts/PaymentAccountDetails';
import { TenantLifecycleControls } from '../tenantLifecycle/TenantLifecycleControls';

/** Look-up-by-id — see schoolQueries.ts's own header comment for why there's no
 * list here. Mostly read-only: School fields themselves have no Platform Admin
 * write endpoint (only a School Owner can edit their own School, via
 * apps/school-portal) — the writes this screen DOES expose are the
 * PaymentAccount section's own "Rotate credential" action (Phase 35's
 * POST .../payment-accounts/:id/rotate-credential) and, as of Phase 57, the
 * close/reactivate account lifecycle (Decision 110/Phase 56 —
 * `TenantLifecycleControls`, shared with FranchiseLookupPage). General
 * tenant-data edits are a separate, not-yet-built slice (see this app's own
 * README) — starting an impersonation session is its own screen
 * (`../impersonation/ImpersonationPage`, Phase 48), not part of this lookup. */
export function SchoolLookupPage() {
  const [idInput, setIdInput] = useState('');
  const [lookedUpId, setLookedUpId] = useState<string | null>(null);

  const school = useSchool(lookedUpId);
  const paymentAccount = useSchoolPaymentAccount(lookedUpId);
  const rotateCredential = useRotateCredential();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLookedUpId(idInput.trim() || null);
  }

  return (
    <>
      <PageHeader title="Look up a School" subtitle="Cross-tenant read, audited on every successful lookup." />
      <Card>
        <form onSubmit={handleSubmit} style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'flex-end' }}>
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
              <p className="ultm8-subcard-title">{school.data.name}</p>
              <dl className="ultm8-info-grid">
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

          {school.data ? (
            <TenantLifecycleControls
              kind="school"
              id={school.data.id}
              name={school.data.name}
              archivedAt={school.data.archivedAt}
              purgeAt={school.data.purgeAt}
              purgedAt={school.data.purgedAt}
            />
          ) : null}

          {/* PaymentAccount is its own audited read (BILLING_PAYMENTS_OPS/
              FULL_ADMIN only) — only attempted once the School itself is
              confirmed to exist, so a School-not-found state doesn't also
              show a confusing "no payment account" message underneath it. */}
          {school.data ? (
            <Card>
              <p className="ultm8-subcard-title">Payment account</p>
              {paymentAccount.isLoading ? <Spinner /> : null}
              {paymentAccount.error instanceof ApiError && paymentAccount.error.status === 404 ? (
                <p>No payment account configured for this School.</p>
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
