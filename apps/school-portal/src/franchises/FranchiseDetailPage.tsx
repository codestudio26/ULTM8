import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { formatMoney } from '../lib/money';
import { paymentStatusBadge } from '../lib/paymentStatusBadge';
import {
  useCloseFranchise,
  useDecideJoinRequest,
  useFranchise,
  useFranchiseFeeCharges,
  useFranchiseJoinRequests,
  useFranchisePaymentAccount,
  useFranchiseSchools,
  useRefundFeeCharge,
  useRemoveFranchiseSchool,
  type FranchiseFeeChargeResponse,
  type FranchiseMemberSchool,
} from './franchiseQueries';
import { useT, type TranslateFn } from '../i18n/I18nProvider';
import { Trans } from '../i18n/Trans';
import { formatLocale } from '../i18n/format';

// FOUND ON REVIEW: an earlier version of this file hand-rolled a local
// `FranchiseSchool` type here instead of reusing the generated
// SchoolResponseDto (which already has exactly these fields) — the one place
// in this phase's new code that broke the established "response types come
// from components['schemas'][...], never re-declared by hand" convention
// every other query/page in this codebase follows.
//
// Decision 337 (F2): the roster now has its own narrow response type
// (FranchiseMemberSchoolResponseDto), no longer the whole School record.
type FranchiseSchool = FranchiseMemberSchool;

/** Decision 337 (F13) — copies the Franchise ID, falling back to selecting the
 * text when the clipboard is unavailable. */
function FranchiseIdLine({ id }: { id: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const codeRef = React.useRef<HTMLElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      setCopied(true);
    } catch {
      const range = document.createRange();
      if (codeRef.current) {
        range.selectNodeContents(codeRef.current);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
    }
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <strong>{t('franchises.detail.franchiseId')}</strong>
        <code ref={codeRef} data-testid="franchise-id" style={{ overflowWrap: 'anywhere' }}>
          {id}
        </code>
        <Button variant="secondary" onClick={copy}>
          {copied ? t('franchises.detail.copied') : t('franchises.detail.copyId')}
        </Button>
      </div>
      <span style={{ color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13 }}>{t('franchises.detail.franchiseIdHint')}</span>
    </div>
  );
}

function subscriptionStatusBadge(status: FranchiseSchool['franchiseFeeSubscriptionStatus'], t: TranslateFn) {
  if (status === 'ACTIVE') return <Badge variant="success">{t('franchises.detail.subscriptionActive')}</Badge>;
  if (status === 'PAST_DUE') return <Badge variant="danger">{t('franchises.detail.subscriptionPastDue')}</Badge>;
  if (status === 'CANCELED') return <Badge>{t('franchises.detail.subscriptionCanceled')}</Badge>;
  return <Badge>{t('franchises.detail.subscriptionNotBilling')}</Badge>;
}

/** A Franchise's own member-School roster + franchise-fee charge history and
 * refund action. Reached via a "View details" link from FranchisesPage's own
 * table, same as ClassDetailPage's identical relationship to ClassesPage
 * (Phase 22). Read-write only for refund — School roster and fee-charge
 * history are display-only, no create/edit endpoint exists for either (rows
 * are written exclusively by franchise-fee-usage-reporting and Stripe
 * webhook handlers — see FranchiseFeesController's own header comment). */
export function FranchiseDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const franchiseId = id ?? null;
  const { data: franchise, isLoading: franchiseLoading, error: franchiseError } = useFranchise(franchiseId);
  const { data: schoolData, isLoading: schoolsLoading, error: schoolsError } = useFranchiseSchools(franchiseId);
  const { data: chargeData, isLoading: chargesLoading, error: chargesError } = useFranchiseFeeCharges(franchiseId);
  const { data: paymentAccount, isLoading: paymentAccountLoading } = useFranchisePaymentAccount(franchiseId);
  const refundCharge = useRefundFeeCharge(franchiseId ?? '');
  const [refunding, setRefunding] = useState<FranchiseFeeChargeResponse | null>(null);
  // Decision 352 — remove a member School (asks first) and close the Franchise.
  const removeSchool = useRemoveFranchiseSchool(franchiseId ?? '');
  const [removing, setRemoving] = useState<FranchiseSchool | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  if (!franchiseId) return null;
  if (franchiseLoading || schoolsLoading || chargesLoading) return <Spinner />;
  if (franchiseError) {
    return <ErrorBanner message={franchiseError instanceof ApiError ? franchiseError.message : t('franchises.detail.loadFailed')} />;
  }
  if (schoolsError) {
    return <ErrorBanner message={schoolsError instanceof ApiError ? schoolsError.message : t('franchises.detail.schoolsLoadFailed')} />;
  }
  if (chargesError) {
    return <ErrorBanner message={chargesError instanceof ApiError ? chargesError.message : t('franchises.detail.chargesLoadFailed')} />;
  }

  const schools: FranchiseSchool[] = schoolData?.items ?? [];
  const charges = chargeData?.items ?? [];
  // Decision 337 (F7) — say why member Schools stay "Not billing yet" instead of
  // leaving it a mystery: no fee set for the chosen fee model, and/or no Stripe
  // account to bill through (connecting one isn't in the portal yet).
  const feeMissing = franchise
    ? franchise.feeModel === 'PER_HEADCOUNT'
      ? franchise.perHeadcountRate == null
      : franchise.flatFeeAmount == null
    : false;
  const stripeMissing = !paymentAccountLoading && !(paymentAccount?.provider === 'STRIPE' && paymentAccount.stripeConnectedAccountId);
  const showBillingNotice = !!franchise && !franchise.archivedAt && (feeMissing || stripeMissing);
  const isOpen = !!franchise && !franchise.archivedAt;

  async function handleRemove() {
    if (!removing) return;
    setRemoveError(null);
    try {
      await removeSchool.mutateAsync(removing.id);
      setRemoving(null);
    } catch (err) {
      setRemoving(null);
      setRemoveError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <>
      <PageHeader
        title={franchise?.name ?? t('franchises.detail.fallbackTitle')}
        subtitle={t('franchises.detail.subtitle', {
          feeModel: franchise?.feeModel === 'PER_HEADCOUNT' ? t('franchises.feeModels.perHeadcount') : t('franchises.feeModels.flat'),
        })}
      />

      <div style={{ marginBottom: 24 }}>
        <Card>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {franchise?.archivedAt ? (
              <div>
                <Badge variant="danger">{t('franchises.list.closed')}</Badge>
              </div>
            ) : null}
            <FranchiseIdLine id={franchiseId} />
            {showBillingNotice ? (
              <div role="status" data-testid="billing-notice">
                <strong>{t('franchises.detail.billingNoticeTitle')}</strong>
                <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                  {feeMissing ? (
                    <li>{franchise?.feeModel === 'PER_HEADCOUNT' ? t('franchises.detail.billingNoticeNoRate') : t('franchises.detail.billingNoticeNoFlatFee')}</li>
                  ) : null}
                  {stripeMissing ? <li>{t('franchises.detail.billingNoticeNoStripe')}</li> : null}
                </ul>
              </div>
            ) : null}
          </div>
        </Card>
      </div>

      {isOpen ? <JoinRequestsCard franchiseId={franchiseId} /> : null}

      <div style={{ marginBottom: 24 }}>
        <Card>
          <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
            {t('franchises.detail.memberSchools')}
          </h2>
          {removeError ? <ErrorBanner message={removeError} /> : null}
          {schools.length === 0 ? (
            <EmptyState
              title={t('franchises.detail.noSchoolsTitle')}
              description={t('franchises.detail.noSchoolsDescription')}
            />
          ) : (
            <Table<FranchiseSchool>
              rows={schools}
              columns={[
                {
                  key: 'name',
                  header: t('franchises.detail.columnName'),
                  // Decision 337 (F9) — a closed member School says so.
                  render: (s) => (
                    <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      {s.name}
                      {s.archivedAt ? <Badge variant="danger">{t('franchises.list.closed')}</Badge> : null}
                    </span>
                  ),
                },
                { key: 'type', header: t('franchises.detail.columnType'), render: (s) => s.businessType ?? '—' },
                { key: 'billing', header: t('franchises.detail.columnFeeBilling'), render: (s) => subscriptionStatusBadge(s.franchiseFeeSubscriptionStatus, t) },
                ...(isOpen
                  ? [
                      {
                        key: 'actions',
                        header: '',
                        render: (s: FranchiseSchool) => (
                          <Button variant="secondary" onClick={() => setRemoving(s)} aria-label={t('franchises.detail.removeSchoolAria', { name: s.name })}>
                            {t('franchises.detail.removeSchool')}
                          </Button>
                        ),
                      },
                    ]
                  : []),
              ]}
            />
          )}
        </Card>
      </div>

      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
          {t('franchises.detail.feeCharges')}
        </h2>
        {charges.length === 0 ? (
          <EmptyState
            title={t('franchises.detail.noChargesTitle')}
            description={t('franchises.detail.noChargesDescription')}
          />
        ) : (
          <Table<FranchiseFeeChargeResponse>
            rows={charges}
            columns={[
              {
                key: 'period',
                header: t('franchises.detail.columnBillingPeriod'),
                render: (c) => `${new Date(c.billingPeriodStart).toLocaleDateString(formatLocale())} – ${new Date(c.billingPeriodEnd).toLocaleDateString(formatLocale())}`,
              },
              {
                key: 'school',
                header: t('franchises.detail.columnSchool'),
                // Decision 337 (F14) — a School that has since left isn't in the roster.
                render: (c) => schools.find((s) => s.id === c.schoolId)?.name ?? t('franchises.detail.formerMember'),
              },
              {
                key: 'basis',
                header: t('franchises.detail.columnBasis'),
                render: (c) => (c.feeBasisSnapshot === 'PER_HEADCOUNT' ? t('franchises.feeModels.perHeadcount') : t('franchises.feeModels.flat')),
              },
              { key: 'amount', header: t('franchises.detail.columnAmount'), render: (c) => formatMoney(c.amount, c.currency) },
              { key: 'status', header: t('franchises.detail.columnStatus'), render: (c) => paymentStatusBadge(c.status) },
              { key: 'refunded', header: t('franchises.detail.columnRefunded'), render: (c) => (c.refundedAmount ? formatMoney(c.refundedAmount, c.currency) : '—') },
              {
                key: 'actions',
                header: '',
                render: (c) =>
                  c.status === 'SUCCESSFUL' && (c.refundedAmount ?? 0) < c.amount ? (
                    <Button variant="danger" onClick={() => setRefunding(c)}>
                      {t('franchises.detail.refund')}
                    </Button>
                  ) : null,
              },
            ]}
          />
        )}
      </Card>

      {isOpen && franchise ? (
        <div style={{ marginTop: 24 }}>
          <Card>
            <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
              {t('franchises.detail.closeTitle')}
            </h2>
            <p style={{ color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13 }}>{t('franchises.detail.closeExplanation')}</p>
            <Button variant="danger" onClick={() => setClosing(true)}>
              {t('franchises.detail.closeButton')}
            </Button>
          </Card>
        </div>
      ) : null}

      {removing ? (
        <Modal title={t('franchises.detail.removeConfirmTitle', { name: removing.name })} onClose={() => setRemoving(null)}>
          <p>{t('franchises.detail.removeConfirmBody')}</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button variant="danger" onClick={handleRemove} loading={removeSchool.isPending}>
              {t('franchises.detail.removeSchool')}
            </Button>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </Modal>
      ) : null}

      {closing && franchise ? <CloseFranchiseModal franchiseId={franchiseId} franchiseName={franchise.name} onClose={() => setClosing(false)} /> : null}

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
  // field in this codebase (e.g. MembershipPlanFormPage's own explicit
  // "Minor currency unit (e.g. cents)" hints). That mismatch is a real
  // under-refund risk: an admin who reads "$50.00" and types "50" meaning
  // fifty dollars would silently refund 50 cents instead. Fixed by keeping
  // the input in the SAME major-unit representation the summary line
  // already shows, converting to minor units only at submit time — this
  // codebase's `formatMoney` already treats every currency as 2-decimal
  // (its own header comment flags zero-decimal currencies like JPY as a
  // known, pre-existing, project-wide limitation), so this conversion adds
  // no new limitation beyond what already exists everywhere money is shown.
  const t = useT();
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
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={t('franchises.refundModal.title')} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <p>
          <Trans
            k="franchises.refundModal.remaining"
            nodes={{ amount: <strong>{formatMoney(remainingMinorUnits, charge.currency)}</strong> }}
          />
        </p>
        <Field
          label={
            charge.currency
              ? t('franchises.refundModal.amountLabelWithCurrency', { currency: charge.currency })
              : t('franchises.refundModal.amountLabel')
          }
          htmlFor="refund-amount"
          hint={t('franchises.refundModal.amountHint')}
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
            {t('franchises.refundModal.confirm')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Decision 352 — Schools asking to join; the Franchise Owner accepts or declines. */
function JoinRequestsCard({ franchiseId }: { franchiseId: string }) {
  const t = useT();
  const { data, error: loadError } = useFranchiseJoinRequests(franchiseId);
  const decide = useDecideJoinRequest(franchiseId);
  const [error, setError] = useState<string | null>(null);
  // Only a Franchise Owner can see these; anyone else just doesn't get the card.
  if (loadError || !data) return null;

  async function handleDecide(requestId: string, accept: boolean) {
    setError(null);
    try {
      await decide.mutateAsync({ requestId, accept });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <div style={{ marginBottom: 24 }} data-testid="join-requests">
      <Card>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
          {t('franchises.detail.joinRequests')}
        </h2>
        {error ? <ErrorBanner message={error} /> : null}
        {data.items.length === 0 ? (
          <p style={{ color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13 }}>{t('franchises.detail.noJoinRequests')}</p>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {data.items.map((r) => (
              <li key={r.id} style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ flex: '1 1 200px' }}>
                  <strong>{r.schoolName}</strong>
                  <br />
                  <span style={{ color: 'var(--ultm8-color-text-muted, #666)', fontSize: 13 }}>
                    {t('franchises.detail.askedOn', { date: new Date(r.createdAt).toLocaleDateString(formatLocale()) })}
                  </span>
                </span>
                <Button onClick={() => handleDecide(r.id, true)} disabled={decide.isPending} aria-label={t('franchises.detail.acceptAria', { name: r.schoolName })}>
                  {t('franchises.detail.accept')}
                </Button>
                <Button variant="secondary" onClick={() => handleDecide(r.id, false)} disabled={decide.isPending} aria-label={t('franchises.detail.declineAria', { name: r.schoolName })}>
                  {t('franchises.detail.decline')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

/** Decision 352 — the Franchise Owner closes their own Franchise: the name
 * re-typed plus their passcode, the same 90-day close as Decision 110's. */
function CloseFranchiseModal({ franchiseId, franchiseName, onClose }: { franchiseId: string; franchiseName: string; onClose: () => void }) {
  const t = useT();
  const close = useCloseFranchise(franchiseId);
  const [confirmName, setConfirmName] = useState('');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await close.mutateAsync({ confirmName, passcode });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={t('franchises.detail.closeConfirmTitle')} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <p>{t('franchises.detail.closeConfirmBody')}</p>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('franchises.detail.closeNameLabel', { name: franchiseName })} htmlFor="close-franchise-name">
          <TextField id="close-franchise-name" required value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label={t('franchises.detail.closePasscodeLabel')} htmlFor="close-franchise-passcode">
          <TextField
            id="close-franchise-passcode"
            type="password"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" variant="danger" loading={close.isPending} disabled={confirmName !== franchiseName}>
            {t('franchises.detail.closeButton')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
