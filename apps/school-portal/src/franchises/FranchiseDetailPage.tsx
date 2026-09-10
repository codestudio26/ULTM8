import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { formatMoney } from '../lib/money';
import { paymentStatusBadge } from '../lib/paymentStatusBadge';
import {
  useFranchise,
  useFranchiseFeeCharges,
  useFranchiseSchools,
  useRefundFeeCharge,
  type FranchiseFeeChargeResponse,
} from './franchiseQueries';

// FOUND ON REVIEW: an earlier version of this file hand-rolled a local
// `FranchiseSchool` type here instead of reusing the generated
// SchoolResponseDto (which already has exactly these fields) — the one place
// in this phase's new code that broke the established "response types come
// from components['schemas'][...], never re-declared by hand" convention
// every other query/page in this codebase follows.
type FranchiseSchool = components['schemas']['SchoolResponseDto'];

function subscriptionStatusBadge(status: FranchiseSchool['franchiseFeeSubscriptionStatus']) {
  if (status === 'ACTIVE') return <Badge variant="success">Active</Badge>;
  if (status === 'PAST_DUE') return <Badge variant="danger">Past due</Badge>;
  if (status === 'CANCELED') return <Badge>Canceled</Badge>;
  return <Badge>Not billing yet</Badge>;
}

/** A Franchise's own member-School roster + franchise-fee charge history and
 * refund action. Reached via a "View details" link from FranchisesPage's own
 * table, same as ClassDetailPage's identical relationship to ClassesPage
 * (Phase 22). Read-write only for refund — School roster and fee-charge
 * history are display-only, no create/edit endpoint exists for either (rows
 * are written exclusively by franchise-fee-usage-reporting and Stripe
 * webhook handlers — see FranchiseFeesController's own header comment). */
export function FranchiseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const franchiseId = id ?? null;
  const { data: franchise, isLoading: franchiseLoading, error: franchiseError } = useFranchise(franchiseId);
  const { data: schoolData, isLoading: schoolsLoading, error: schoolsError } = useFranchiseSchools(franchiseId);
  const { data: chargeData, isLoading: chargesLoading, error: chargesError } = useFranchiseFeeCharges(franchiseId);
  const refundCharge = useRefundFeeCharge(franchiseId ?? '');
  const [refunding, setRefunding] = useState<FranchiseFeeChargeResponse | null>(null);

  if (!franchiseId) return null;
  if (franchiseLoading || schoolsLoading || chargesLoading) return <Spinner />;
  if (franchiseError) {
    return <ErrorBanner message={franchiseError instanceof ApiError ? franchiseError.message : 'Could not load this Franchise.'} />;
  }
  if (schoolsError) {
    return <ErrorBanner message={schoolsError instanceof ApiError ? schoolsError.message : 'Could not load its member Schools.'} />;
  }
  if (chargesError) {
    return <ErrorBanner message={chargesError instanceof ApiError ? chargesError.message : 'Could not load its fee-charge history.'} />;
  }

  const schools: FranchiseSchool[] = schoolData?.items ?? [];
  const charges = chargeData?.items ?? [];

  return (
    <>
      <PageHeader
        title={franchise?.name ?? 'Franchise'}
        subtitle={`Fee model: ${franchise?.feeModel === 'PER_HEADCOUNT' ? 'Per-headcount' : 'Flat'}`}
      />

      <div style={{ marginBottom: 24 }}>
        <Card>
          <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
            Member Schools
          </h2>
          {schools.length === 0 ? (
            <EmptyState
              title="No member Schools yet"
              description="A School joins this Franchise itself, from its own School settings — there's no invite-from-here flow yet."
            />
          ) : (
            <Table<FranchiseSchool>
              rows={schools}
              columns={[
                { key: 'name', header: 'Name', render: (s) => s.name },
                { key: 'type', header: 'Type', render: (s) => s.businessType ?? '—' },
                { key: 'billing', header: 'Fee billing', render: (s) => subscriptionStatusBadge(s.franchiseFeeSubscriptionStatus) },
              ]}
            />
          )}
        </Card>
      </div>

      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
          Fee charges
        </h2>
        {charges.length === 0 ? (
          <EmptyState
            title="No fee charges yet"
            description="Charges appear here once a member School's franchise-fee billing has actually run."
          />
        ) : (
          <Table<FranchiseFeeChargeResponse>
            rows={charges}
            columns={[
              {
                key: 'period',
                header: 'Billing period',
                render: (c) => `${new Date(c.billingPeriodStart).toLocaleDateString()} – ${new Date(c.billingPeriodEnd).toLocaleDateString()}`,
              },
              {
                key: 'school',
                header: 'School',
                render: (c) => schools.find((s) => s.id === c.schoolId)?.name ?? c.schoolId.slice(0, 8),
              },
              { key: 'basis', header: 'Basis', render: (c) => (c.feeBasisSnapshot === 'PER_HEADCOUNT' ? 'Per-headcount' : 'Flat') },
              { key: 'amount', header: 'Amount', render: (c) => formatMoney(c.amount, c.currency) },
              { key: 'status', header: 'Status', render: (c) => paymentStatusBadge(c.status) },
              { key: 'refunded', header: 'Refunded', render: (c) => (c.refundedAmount ? formatMoney(c.refundedAmount, c.currency) : '—') },
              {
                key: 'actions',
                header: '',
                render: (c) =>
                  c.status === 'SUCCESSFUL' && (c.refundedAmount ?? 0) < c.amount ? (
                    <Button variant="danger" onClick={() => setRefunding(c)}>
                      Refund
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </Card>

      {refunding ? (
        <RefundModal
          charge={refunding}
          submitting={refundCharge.isPending}
          onSubmit={async (amount) => {
            await refundCharge.mutateAsync({ chargeId: refunding.id, amount });
            setRefunding(null);
          }}
          onClose={() => setRefunding(null)}
        />
      ) : null}
    </>
  );
}

function RefundModal({
  charge,
  submitting,
  onSubmit,
  onClose,
}: {
  charge: FranchiseFeeChargeResponse;
  submitting: boolean;
  onSubmit: (amount?: number) => Promise<void>;
  onClose: () => void;
}) {
  // amount/RefundFranchiseFeeChargeDto.amount are minor units (cents) —
  // FOUND ON REVIEW: an earlier version of this modal displayed
  // "Remaining refundable" via formatMoney (major units, e.g. "50.00 USD")
  // directly above an input that submitted the SAME raw minor-unit number
  // with no conversion and no unit hint, unlike every other money-entry
  // field in this codebase (e.g. MembershipPlanFormModal's own explicit
  // "Minor currency unit (e.g. cents)" hints). That mismatch is a real
  // under-refund risk: an admin who reads "$50.00" and types "50" meaning
  // fifty dollars would silently refund 50 cents instead. Fixed by keeping
  // the input in the SAME major-unit representation the summary line
  // already shows, converting to minor units only at submit time — this
  // codebase's `formatMoney` already treats every currency as 2-decimal
  // (its own header comment flags zero-decimal currencies like JPY as a
  // known, pre-existing, project-wide limitation), so this conversion adds
  // no new limitation beyond what already exists everywhere money is shown.
  const remainingMinorUnits = charge.amount - (charge.refundedAmount ?? 0);
  const remainingMajorUnits = remainingMinorUnits / 100;
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      // Omitted entirely means "refund the full remaining balance" —
      // RefundFranchiseFeeChargeDto's own documented default. Otherwise,
      // convert the major-unit form value back to minor units for the API.
      await onSubmit(amount ? Math.round(Number(amount) * 100) : undefined);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  return (
    <Modal title="Refund fee charge" onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <p>
          Remaining refundable: <strong>{formatMoney(remainingMinorUnits, charge.currency)}</strong>
        </p>
        <Field
          label={`Amount to refund${charge.currency ? ` (${charge.currency})` : ''}`}
          htmlFor="refund-amount"
          hint="Same currency and units as the balance above. Leave blank to refund the full remaining balance."
        >
          <TextField
            type="number"
            min={0.01}
            step={0.01}
            max={remainingMajorUnits}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" variant="danger" loading={submitting}>
            Confirm refund
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
