import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Button, EmptyState, ErrorBanner, Field, Modal, Spinner, TextField } from '@ultm8/ui';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { localCountryNames } from '../lib/countryNames';
import { ApiError } from '@ultm8/api-client';
import { formatMoney } from '../lib/money';
import { paymentStatusBadge } from '../lib/paymentStatusBadge';
import {
  STRIPE_CONNECT_RETURN_KEY,
  useCloseFranchise,
  useConnectFranchiseStripe,
  useDecideJoinRequest,
  useFranchiseConnectStatus,
  useFranchise,
  useFranchiseFeeCharges,
  useFranchiseJoinRequests,
  useFranchisePaymentAccount,
  useFranchiseSchools,
  useRefundFeeCharge,
  useRemoveFranchiseSchool,
  type ConnectStatus,
  type FranchiseFeeChargeResponse,
  type FranchiseMemberSchool,
} from './franchiseQueries';
import { useT, type TranslateFn } from '../i18n/I18nProvider';
import { Trans } from '../i18n/Trans';
import { formatLocale } from '../i18n/format';
import { NewLookPageHeader } from '../layout/NewLookPage';
import { NewLookSelect } from '../layout/NewLookSelect';
import '../students/studentsList.css';
import '../organisation/organisationLook.css';

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
    <div className="u8o-row">
      <strong className="u8o-rowname" style={{ fontSize: 14 }}>
        {t('franchises.detail.franchiseId')}
      </strong>
      <code ref={codeRef} data-testid="franchise-id" className="u8o-code">
        {id}
      </code>
      <button type="button" className="u8n-pill u8o-pill--sm" onClick={copy}>
        {copied ? t('franchises.detail.copied') : t('franchises.detail.copyId')}
      </button>
      <p className="u8o-quiet" style={{ flex: '1 1 100%' }}>
        {t('franchises.detail.franchiseIdHint')}
      </p>
    </div>
  );
}

function subscriptionStatusBadge(status: FranchiseSchool['franchiseFeeSubscriptionStatus'], t: TranslateFn) {
  if (status === 'ACTIVE') return <span className="u8n-tag u8n-tag--active">{t('franchises.detail.subscriptionActive')}</span>;
  if (status === 'PAST_DUE') return <span className="u8n-tag u8o-tag--closed">{t('franchises.detail.subscriptionPastDue')}</span>;
  if (status === 'CANCELED') return <span className="u8n-tag u8n-tag--inactive">{t('franchises.detail.subscriptionCanceled')}</span>;
  return <span className="u8n-tag u8n-tag--inactive">{t('franchises.detail.subscriptionNotBilling')}</span>;
}

/** A new-look card: a light header with the title, then the body. */
function OrgCard({ title, children, testId, danger, flush }: { title: string; children: React.ReactNode; testId?: string; danger?: boolean; flush?: boolean }) {
  return (
    <section className={'u8o-card' + (danger ? ' u8o-card--danger' : '')} data-testid={testId} aria-label={title}>
      <header className="u8o-card__head">
        <h2 className="u8o-card__title">{title}</h2>
      </header>
      <div className={'u8o-card__body' + (flush ? ' u8o-card__body--flush' : '')}>{children}</div>
    </section>
  );
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
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const franchiseId = id ?? null;
  const { data: franchise, isLoading: franchiseLoading, error: franchiseError } = useFranchise(franchiseId);
  const { data: schoolData, isLoading: schoolsLoading, error: schoolsError } = useFranchiseSchools(franchiseId);
  const { data: chargeData, isLoading: chargesLoading, error: chargesError } = useFranchiseFeeCharges(franchiseId);
  const { data: paymentAccount, isLoading: paymentAccountLoading } = useFranchisePaymentAccount(franchiseId);
  // Decision 437 — the same query StripeConnectCard reads (shared cache).
  const { data: connectStatus } = useFranchiseConnectStatus(franchiseId);
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
  // account to bill through (Decision 407: connected below, StripeConnectCard).
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
    <div className="u8o">
      <NewLookPageHeader
        parent={{ to: '/franchises', label: t('franchises.list.title') }}
        title={franchise?.name ?? t('franchises.detail.fallbackTitle')}
        subtitle={t('franchises.detail.subtitle', {
          feeModel: franchise?.feeModel === 'PER_HEADCOUNT' ? t('franchises.feeModels.perHeadcount') : t('franchises.feeModels.flat'),
        })}
        actions={
          // Decision 450 item 1 — the member Schools' totals.
          <button type="button" className="u8n-pill" data-testid="franchise-overview-link" onClick={() => navigate(`/franchises/${franchiseId}/overview`)}>
            {t('franchises.overview.open')}
          </button>
        }
      />

      <section className="u8o-card" aria-label={t('franchises.detail.franchiseId')}>
        <div className="u8o-card__body">
          {franchise?.archivedAt ? <span className="u8n-tag u8o-tag--closed">{t('franchises.list.closed')}</span> : null}
          <FranchiseIdLine id={franchiseId} />
          {showBillingNotice ? (
            <div role="status" data-testid="billing-notice" className="u8o-note">
              <strong>{t('franchises.detail.billingNoticeTitle')}</strong>
              <ul>
                {feeMissing ? (
                  <li>{franchise?.feeModel === 'PER_HEADCOUNT' ? t('franchises.detail.billingNoticeNoRate') : t('franchises.detail.billingNoticeNoFlatFee')}</li>
                ) : null}
                {stripeMissing ? (
                  <li>
                    {connectStatus?.connectAvailable === false
                      ? t('franchises.detail.billingNoticeStripeUnavailable')
                      : t('franchises.detail.billingNoticeNoStripe')}
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </div>
      </section>

      {isOpen && franchise ? (
        <StripeConnectCard
          franchiseId={franchiseId}
          franchiseName={franchise.name}
          defaultCountry={franchise.addressCountry ?? null}
          paymentAccount={paymentAccount ?? null}
        />
      ) : null}

      {isOpen ? <JoinRequestsCard franchiseId={franchiseId} /> : null}

      <OrgCard title={t('franchises.detail.memberSchools')} flush>
        {removeError ? <ErrorBanner message={removeError} /> : null}
        {schools.length === 0 ? (
          <EmptyState title={t('franchises.detail.noSchoolsTitle')} description={t('franchises.detail.noSchoolsDescription')} />
        ) : (
          <div className="u8n-list__scroll">
            <table className="u8n-table">
              <thead>
                <tr>
                  <th scope="col">{t('franchises.detail.columnName')}</th>
                  <th scope="col">{t('franchises.detail.columnType')}</th>
                  <th scope="col">{t('franchises.detail.columnFeeBilling')}</th>
                  {isOpen ? (
                    <th scope="col">
                      <span className="u8n-visually-hidden">{t('franchises.detail.removeSchool')}</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {schools.map((s) => (
                  <tr key={s.id}>
                    {/* Decision 337 (F9) — a closed member School says so. */}
                    <td>
                      <span className="u8o-row u8o-rowname" style={{ gap: 8 }}>
                        {s.name}
                        {s.archivedAt ? <span className="u8n-tag u8o-tag--closed">{t('franchises.list.closed')}</span> : null}
                      </span>
                    </td>
                    <td>{s.businessType ?? '—'}</td>
                    <td>{subscriptionStatusBadge(s.franchiseFeeSubscriptionStatus, t)}</td>
                    {isOpen ? (
                      <td>
                        <div className="u8o-actions">
                          <button type="button" className="u8n-pill u8o-pill--sm u8o-pill--red" onClick={() => setRemoving(s)} aria-label={t('franchises.detail.removeSchoolAria', { name: s.name })}>
                            {t('franchises.detail.removeSchool')}
                          </button>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </OrgCard>

      <OrgCard title={t('franchises.detail.feeCharges')} flush>
        {charges.length === 0 ? (
          <EmptyState title={t('franchises.detail.noChargesTitle')} description={t('franchises.detail.noChargesDescription')} />
        ) : (
          <div className="u8n-list__scroll">
            <table className="u8n-table">
              <thead>
                <tr>
                  <th scope="col">{t('franchises.detail.columnBillingPeriod')}</th>
                  <th scope="col">{t('franchises.detail.columnSchool')}</th>
                  <th scope="col">{t('franchises.detail.columnBasis')}</th>
                  <th scope="col" className="u8o-num">{t('franchises.detail.columnAmount')}</th>
                  <th scope="col">{t('franchises.detail.columnStatus')}</th>
                  <th scope="col" className="u8o-num">{t('franchises.detail.columnRefunded')}</th>
                  <th scope="col">
                    <span className="u8n-visually-hidden">{t('franchises.detail.refund')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {charges.map((c) => (
                  <tr key={c.id}>
                    <td>{`${new Date(c.billingPeriodStart).toLocaleDateString(formatLocale())} – ${new Date(c.billingPeriodEnd).toLocaleDateString(formatLocale())}`}</td>
                    {/* Decision 337 (F14) — a School that has since left isn't in the roster. */}
                    <td>{schools.find((s) => s.id === c.schoolId)?.name ?? t('franchises.detail.formerMember')}</td>
                    <td>{c.feeBasisSnapshot === 'PER_HEADCOUNT' ? t('franchises.feeModels.perHeadcount') : t('franchises.feeModels.flat')}</td>
                    <td className="u8o-num">{formatMoney(c.amount, c.currency)}</td>
                    <td>{paymentStatusBadge(c.status)}</td>
                    <td className="u8o-num">{c.refundedAmount ? formatMoney(c.refundedAmount, c.currency) : '—'}</td>
                    <td>
                      {c.status === 'SUCCESSFUL' && (c.refundedAmount ?? 0) < c.amount ? (
                        <div className="u8o-actions">
                          <button type="button" className="u8n-pill u8o-pill--sm u8o-pill--red" onClick={() => setRefunding(c)}>
                            {t('franchises.detail.refund')}
                          </button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </OrgCard>

      {isOpen && franchise ? (
        <OrgCard title={t('franchises.detail.closeTitle')} danger>
          <p className="u8o-quiet">{t('franchises.detail.closeExplanation')}</p>
          <button type="button" className="u8n-pill u8o-pill--red" onClick={() => setClosing(true)}>
            {t('franchises.detail.closeButton')}
          </button>
        </OrgCard>
      ) : null}

      {removing ? (
        <Modal title={t('franchises.detail.removeConfirmTitle', { name: removing.name })} onClose={() => setRemoving(null)}>
          <p>{t('franchises.detail.removeConfirmBody')}</p>
          <div className="u8o-pair">
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
    </div>
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
        <div className="u8o-pair">
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
    <OrgCard title={t('franchises.detail.joinRequests')} testId="join-requests">
      {error ? <ErrorBanner message={error} /> : null}
      {data.items.length === 0 ? (
        <p className="u8o-quiet">{t('franchises.detail.noJoinRequests')}</p>
      ) : (
        <ul className="u8o-requests">
          {data.items.map((r) => (
            <li key={r.id} className="u8o-request">
              <span className="u8o-request__who">
                <span className="u8o-rowname">{r.schoolName}</span>
                <span className="u8o-quiet">{t('franchises.detail.askedOn', { date: new Date(r.createdAt).toLocaleDateString(formatLocale()) })}</span>
              </span>
              <span className="u8o-request__buttons">
                <button type="button" className="u8n-pill u8n-pill--primary" onClick={() => handleDecide(r.id, true)} disabled={decide.isPending} aria-label={t('franchises.detail.acceptAria', { name: r.schoolName })}>
                  {t('franchises.detail.accept')}
                </button>
                <button type="button" className="u8n-pill" onClick={() => handleDecide(r.id, false)} disabled={decide.isPending} aria-label={t('franchises.detail.declineAria', { name: r.schoolName })}>
                  {t('franchises.detail.decline')}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </OrgCard>
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
        <div className="u8o-pair">
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

function connectStatusBadge(status: ConnectStatus, t: TranslateFn) {
  if (status === 'CONNECTED') return <span className="u8n-tag u8n-tag--active">{t('franchises.stripe.connected')}</span>;
  if (status === 'ACTION_NEEDED') return <span className="u8n-tag u8o-tag--warn">{t('franchises.stripe.actionNeeded')}</span>;
  return <span className="u8n-tag u8n-tag--inactive">{t('franchises.stripe.notConnected')}</span>;
}

/**
 * Decision 407 — the Franchise Owner connects the Franchise's Stripe account,
 * which member Schools' franchise fees are paid into, through Stripe's own
 * onboarding (the existing payment-account endpoints). Shows Connected, Action
 * needed (onboarding started but not finished, or Stripe wants more details)
 * or Not connected. The first time, the Owner picks the country of the
 * business's bank account: Stripe needs it and it can't be changed later.
 */
function StripeConnectCard({
  franchiseId,
  franchiseName,
  defaultCountry,
  paymentAccount,
}: {
  franchiseId: string;
  franchiseName: string;
  defaultCountry: string | null;
  paymentAccount: { id: string; provider: string } | null;
}) {
  const t = useT();
  const { data, isLoading, error: statusError } = useFranchiseConnectStatus(franchiseId);
  const connect = useConnectFranchiseStripe(franchiseId);
  const [askingCountry, setAskingCountry] = useState(false);
  const [country, setCountry] = useState(defaultCountry ?? guessDefaultCountry() ?? '');
  const [error, setError] = useState<string | null>(null);
  // Decision 437 — the picker offers only the countries where Stripe can
  // onboard the Franchise (the API's list), and the button is hidden where
  // it can't.
  const allowed = data?.connectCountries;
  const countries = React.useMemo(() => {
    const all = localCountryNames();
    return allowed ? all.filter((c) => allowed.includes(c.value)) : all;
  }, [allowed]);
  // A cash or bank-transfer account can't go through Stripe.
  const stripeAccountId = paymentAccount?.provider === 'STRIPE' ? paymentAccount.id : null;
  const connectAvailable = data?.connectAvailable !== false;
  const canConnect = connectAvailable && (!paymentAccount || !!stripeAccountId);

  async function start(chosenCountry: string) {
    setError(null);
    try {
      const url = await connect.mutateAsync({ paymentAccountId: stripeAccountId, accountTitle: franchiseName, country: chosenCountry });
      try {
        sessionStorage.setItem(STRIPE_CONNECT_RETURN_KEY, `/franchises/${franchiseId}`);
      } catch {
        // No storage: Stripe's return lands on the Franchises page instead.
      }
      window.location.assign(url);
    } catch (err) {
      setAskingCountry(false);
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  const status = data?.status;
  return (
    <OrgCard title={t('franchises.stripe.title')} testId="stripe-connect">
      {error ? <ErrorBanner message={error} /> : null}
      {isLoading ? (
        <Spinner />
      ) : statusError ? (
        <ErrorBanner message={statusError instanceof ApiError ? statusError.message : t('franchises.stripe.statusLoadFailed')} />
      ) : status ? (
        <>
          <span data-testid="stripe-connect-status">{connectStatusBadge(status, t)}</span>
          <p className="u8o-quiet" data-testid="stripe-connect-hint">
            {status === 'CONNECTED'
              ? t('franchises.stripe.connectedHint')
              : !connectAvailable
                ? // Decision 448 item 5: Pix is named only in Brazil.
                  t(defaultCountry?.toUpperCase() === 'BR' ? 'franchises.stripe.unavailableHintPix' : 'franchises.stripe.unavailableHint')
                : status === 'ACTION_NEEDED'
                  ? t('franchises.stripe.actionNeededHint')
                  : t('franchises.stripe.notConnectedHint')}
          </p>
          {status !== 'CONNECTED' && canConnect ? (
            <Button
              onClick={() => {
                if (stripeAccountId) {
                  void start('');
                  return;
                }
                if (allowed && !allowed.includes(country)) setCountry('');
                setAskingCountry(true);
              }}
              loading={connect.isPending}
            >
              {status === 'ACTION_NEEDED' ? t('franchises.stripe.continue') : t('franchises.stripe.connect')}
            </Button>
          ) : null}
        </>
      ) : null}
      {askingCountry ? (
        <Modal title={t('franchises.stripe.countryTitle')} onClose={() => setAskingCountry(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void start(country);
            }}
          >
            <div className="u8o-modal-field">
              <NewLookSelect
                id="stripe-connect-country"
                label={t('franchises.stripe.countryLabel')}
                value={country}
                onChange={setCountry}
                options={[{ value: '', label: t('franchises.stripe.chooseCountry') }, ...countries]}
              />
              <p className="u8o-quiet" style={{ marginTop: 6 }}>
                {t('franchises.stripe.countryHint')}
              </p>
            </div>
            <div className="u8o-pair">
              <Button type="submit" loading={connect.isPending} disabled={!country}>
                {t('franchises.stripe.goToStripe')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setAskingCountry(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </OrgCard>
  );
}
