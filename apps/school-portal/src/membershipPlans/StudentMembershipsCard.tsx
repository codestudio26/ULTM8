import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, EmptyState, ErrorBanner, Field, Modal, ModalActions, Spinner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { StudentCard } from '../students/StudentPageLook';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { PAYMENT_METHOD_LABELS } from '../lib/enumLabels';
import { formatMoney } from '../lib/money';
import { formatLocale } from '../i18n/format';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import {
  DESK_PAYMENT_METHODS,
  useCancelMembership,
  useGiftFriendPass,
  useMembershipPlans,
  useSchoolTakesNoCards,
  useSellMembership,
  useStudentMemberships,
  type DeskPaymentMethod,
  type MembershipPlanResponse,
  type StudentMembershipResponse,
} from './membershipPlanQueries';
import {
  FREEZABLE_TYPES,
  dayFromToday,
  formatCalendarDay,
  useFreezeAction,
  useFreezeMembership,
  useStudentFreezableMemberships,
} from './freezeQueries';
import { useSchool } from '../schools/schoolQueries';
import { useDeskMethods } from '../lib/deskMethods';
import { JoiningFeeNotice } from './JoiningFeeNotice';
import { NewLookSelect } from '../layout/NewLookSelect';

const TYPE_LABELS: Record<string, TranslationKey> = {
  SUBSCRIPTION: 'membershipPlans.types.subscription',
  CLASS_PACK: 'membershipPlans.types.classPack',
  WEEKLY_PASS: 'membershipPlans.types.weeklyPass',
  FRIEND_PASS: 'membershipPlans.types.friendPass',
  TRIAL_MEMBERSHIP: 'membershipPlans.types.trialMembership',
  VISIT_PASS: 'membershipPlans.types.visitPass',
};

/** Plans the owner can sell at the desk: not a Subscription (card only) or a
 * Friend Pass (given, not sold). Decision 441 item 1: a School that takes no
 * cards sells its monthly plans here too (DESK_TYPES_NO_CARDS). */
const DESK_TYPES = ['CLASS_PACK', 'WEEKLY_PASS', 'TRIAL_MEMBERSHIP'];
const DESK_TYPES_NO_CARDS = [...DESK_TYPES, 'SUBSCRIPTION'];

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

/** A row of the card: a full membership for the owner, or (freezeOnly) the
 * few fields Branch Staff who may freeze get (Decision 409). */
type MembershipRow = Pick<StudentMembershipResponse, 'id' | 'planTitle' | 'planType' | 'live' | 'frozen' | 'freeze'> & {
  expiryDate?: string | null;
  cancelAt?: string | null;
  classesRemaining?: number | null;
  giftedById?: string | null;
  awaitingFirstCheckIn?: boolean;
  switchToPlanId?: string | null;
  billedToBalance?: boolean;
};

/**
 * The owner's view of one Student's memberships (Decision 348): what they
 * hold, selling a plan at the desk (cash, bank transfer, Pix or card
 * terminal), giving a Friend
 * Pass, and cancelling a Subscription at the end of its paid month.
 *
 * `freezeOnly` (Decision 409): Branch Staff with "Can freeze memberships"
 * see only the memberships that can be frozen, with the freeze actions; no
 * selling, Friend Pass or cancelling, which stay the owner's.
 */
export function StudentMembershipsCard({
  schoolId,
  studentId,
  studentName,
  freezeOnly = false,
}: {
  schoolId: string;
  studentId: string;
  studentName: string;
  freezeOnly?: boolean;
}) {
  const t = useT();
  const full = useStudentMemberships(freezeOnly ? null : schoolId, studentId);
  const freezable = useStudentFreezableMemberships(freezeOnly ? schoolId : null, studentId);
  const memberships = freezeOnly
    ? { ...freezable, data: freezable.data ? { items: freezable.data.items.map((m): MembershipRow => ({ ...m, live: true })) } : undefined }
    : full;
  const plans = useMembershipPlans(freezeOnly ? null : schoolId);
  const noCards = useSchoolTakesNoCards(freezeOnly ? null : schoolId);
  const cancel = useCancelMembership(schoolId, studentId);
  const [dialog, setDialog] = useState<'sell' | 'gift' | null>(null);
  const [cancelling, setCancelling] = useState<MembershipRow | null>(null);
  // Decision 404: freezing a membership.
  const [freezing, setFreezing] = useState<MembershipRow | null>(null);
  const [ending, setEnding] = useState<MembershipRow | null>(null);
  const freezeAction = useFreezeAction(schoolId);
  const [freezeError, setFreezeError] = useState<string | null>(null);

  async function decide(freezeId: string, action: 'approve' | 'decline') {
    setFreezeError(null);
    try {
      await freezeAction.mutateAsync({ freezeId, action });
    } catch (err) {
      setFreezeError(err instanceof ApiError ? err.message : t('membershipPlans.studentCard.freeze.decideFailed'));
    }
  }

  const activePlans = (plans.data?.items ?? []).filter((p) => !p.archivedAt);
  // Decision 316 item 6: a plan with a contract is signed and bought in the app.
  const deskTypes = noCards ? DESK_TYPES_NO_CARDS : DESK_TYPES;
  const sellable = activePlans.filter((p) => deskTypes.includes(p.type) && p.contractVersion == null);
  const friendPasses = activePlans.filter((p) => p.type === 'FRIEND_PASS');

  function statusOf(m: MembershipRow) {
    if (!m.live) return <Badge variant="default">{t('membershipPlans.studentCard.ended')}</Badge>;
    // Decision 404: frozen, a freeze to come, or a request waiting.
    if (m.frozen && m.freeze) return <Badge variant="info">{t('membershipPlans.studentCard.freeze.frozenUntil', { date: formatCalendarDay(m.freeze.endsAt) })}</Badge>;
    if (m.freeze?.status === 'APPROVED') return <Badge variant="info">{t('membershipPlans.studentCard.freeze.freezeFrom', { date: formatCalendarDay(m.freeze.startsAt) })}</Badge>;
    if (m.freeze?.status === 'REQUESTED') {
      return (
        <Badge variant="warning">
          {t('membershipPlans.studentCard.freeze.requested', { start: formatCalendarDay(m.freeze.startsAt), end: formatCalendarDay(m.freeze.endsAt) })}
        </Badge>
      );
    }
    if (m.cancelAt) return <Badge variant="warning">{t('membershipPlans.studentCard.endsOn', { date: formatDay(m.cancelAt) })}</Badge>;
    return <Badge variant="success">{t('membershipPlans.studentCard.active')}</Badge>;
  }

  function detailsOf(m: MembershipRow) {
    const parts: string[] = [];
    if (m.classesRemaining !== null && m.classesRemaining !== undefined) parts.push(t('membershipPlans.studentCard.classesLeft', { count: m.classesRemaining }));
    // Decision 441 item 1: a cancelled monthly plan billed to the balance ends
    // on its cancel date, already shown as its status.
    if (m.expiryDate && !(m.billedToBalance && m.cancelAt)) parts.push(t('membershipPlans.studentCard.expires', { date: formatDay(m.expiryDate) }));
    // Decision 435 items 7 and 9: not started yet, and the plan it switches to.
    if (m.awaitingFirstCheckIn) parts.push(t('membershipPlans.studentCard.awaitingFirstCheckIn'));
    const next = m.switchToPlanId ? plans.data?.items.find((p) => p.id === m.switchToPlanId) : undefined;
    if (next) parts.push(t('membershipPlans.studentCard.switchesTo', { plan: next.title }));
    if (m.giftedById) parts.push(t('membershipPlans.studentCard.given'));
    // A freeze pauses a monthly plan's billing: a card Subscription's
    // (Decision 404) and, since Decision 442 item 5, one billed to the balance.
    if (m.frozen && m.planType === 'SUBSCRIPTION') parts.push(t('membershipPlans.studentCard.freeze.billingPaused'));
    return parts.join(' · ') || t('common.none');
  }

  return (
    <>
      <StudentCard
        title={t('membershipPlans.studentCard.title')}
        actions={
          freezeOnly ? null : (
            <>
              <Button onClick={() => setDialog('sell')}>{t('membershipPlans.studentCard.sell')}</Button>
              <Button variant="secondary" onClick={() => setDialog('gift')}>
                {t('membershipPlans.studentCard.gift')}
              </Button>
            </>
          )
        }
      >
        {memberships.isLoading ? (
          <Spinner />
        ) : memberships.error ? (
          <ErrorBanner message={memberships.error instanceof ApiError ? memberships.error.message : t('membershipPlans.studentCard.loadFailed')} />
        ) : null}
        {freezeError ? <ErrorBanner message={freezeError} /> : null}
        {memberships.isLoading || memberships.error ? null : (memberships.data?.items ?? []).length === 0 ? (
          freezeOnly ? (
            <p style={{ margin: 0 }}>{t('membershipPlans.studentCard.freeze.staffEmpty')}</p>
          ) : (
            <EmptyState title={t('membershipPlans.studentCard.emptyTitle')} description={t('membershipPlans.studentCard.emptyDescription')} />
          )
        ) : (
          <Table<MembershipRow>
            rows={memberships.data?.items ?? []}
            columns={[
              { key: 'plan', header: t('membershipPlans.studentCard.columnPlan'), render: (m) => m.planTitle },
              { key: 'type', header: t('membershipPlans.list.columnType'), render: (m) => (TYPE_LABELS[m.planType] ? t(TYPE_LABELS[m.planType]) : m.planType) },
              { key: 'status', header: t('membershipPlans.studentCard.columnStatus'), render: statusOf },
              { key: 'details', header: t('membershipPlans.studentCard.columnDetails'), render: detailsOf },
              {
                key: 'actions',
                header: '',
                render: (m) => (
                  <span style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
                    {!freezeOnly && m.planType === 'SUBSCRIPTION' && m.live && !m.cancelAt ? (
                      <Button variant="secondary" onClick={() => setCancelling(m)}>
                        {t('membershipPlans.studentCard.cancel')}
                      </Button>
                    ) : null}
                    {FREEZABLE_TYPES.includes(m.planType) && m.live && !m.cancelAt && !m.freeze ? (
                      <Button variant="secondary" onClick={() => setFreezing(m)}>
                        {t('membershipPlans.studentCard.freeze.freeze')}
                      </Button>
                    ) : null}
                    {m.freeze?.status === 'APPROVED' ? (
                      <Button variant="secondary" onClick={() => setEnding(m)}>
                        {t('membershipPlans.studentCard.freeze.end')}
                      </Button>
                    ) : null}
                    {m.freeze?.status === 'REQUESTED' ? (
                      <>
                        <Button variant="secondary" loading={freezeAction.isPending} onClick={() => decide(m.freeze!.id, 'approve')}>
                          {t('membershipPlans.studentCard.freeze.approve')}
                        </Button>
                        <Button variant="secondary" loading={freezeAction.isPending} onClick={() => decide(m.freeze!.id, 'decline')}>
                          {t('membershipPlans.studentCard.freeze.decline')}
                        </Button>
                      </>
                    ) : null}
                  </span>
                ),
              },
            ]}
          />
        )}
      </StudentCard>

      {dialog === 'sell' ? (
        <DeskModal kind="sell" schoolId={schoolId} studentId={studentId} studentName={studentName} plans={sellable} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'gift' ? (
        <DeskModal kind="gift" schoolId={schoolId} studentId={studentId} studentName={studentName} plans={friendPasses} onClose={() => setDialog(null)} />
      ) : null}
      {freezing ? <FreezeModal schoolId={schoolId} membership={freezing} studentName={studentName} onClose={() => setFreezing(null)} /> : null}
      {ending?.freeze ? (
        <ConfirmDeleteModal
          title={t('membershipPlans.studentCard.freeze.endTitle')}
          description={t('membershipPlans.studentCard.freeze.endDescription')}
          confirmLabel={t('membershipPlans.studentCard.freeze.endConfirm')}
          genericErrorMessage={t('membershipPlans.studentCard.freeze.endFailed')}
          onConfirm={() => freezeAction.mutateAsync({ freezeId: ending.freeze!.id, action: 'end' })}
          onClose={() => setEnding(null)}
        />
      ) : null}
      {cancelling ? (
        <ConfirmDeleteModal
          title={t('membershipPlans.studentCard.cancelTitle', { plan: cancelling.planTitle })}
          description={t('membershipPlans.studentCard.cancelDescription', { name: studentName })}
          confirmLabel={t('membershipPlans.studentCard.cancelConfirm')}
          genericErrorMessage={t('membershipPlans.studentCard.cancelFailed')}
          onConfirm={() => cancel.mutateAsync(cancelling.id)}
          onClose={() => setCancelling(null)}
        />
      ) : null}
    </>
  );
}

/**
 * Decision 404: staff freeze a membership straight away (the owner, or
 * Branch Staff with "Can freeze memberships", Decision 409). At least 7 days,
 * starting today or later; the member is back on the end date. Shows the
 * School's maximum and its fee, if any (charged when the freeze is made).
 */
function FreezeModal({
  schoolId,
  membership,
  studentName,
  onClose,
}: {
  schoolId: string;
  membership: Pick<MembershipRow, 'id' | 'planTitle'>;
  studentName: string;
  onClose: () => void;
}) {
  const t = useT();
  const school = useSchool(schoolId);
  const freeze = useFreezeMembership(schoolId);
  const [startsAt, setStartsAt] = useState(dayFromToday(0));
  const [endsAt, setEndsAt] = useState(dayFromToday(30));
  const [error, setError] = useState<string | null>(null);
  const fee = school.data?.freezeFeeAmount ?? null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await freeze.mutateAsync({ membershipId: membership.id, startsAt, endsAt });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('membershipPlans.studentCard.freeze.failed'));
    }
  }

  return (
    <Modal title={t('membershipPlans.studentCard.freeze.modalTitle', { plan: membership.planTitle, name: studentName })} onClose={onClose}>
      <form onSubmit={submit} data-testid="freeze-modal">
        {error ? <ErrorBanner message={error} /> : null}
        <p>{t('membershipPlans.studentCard.freeze.intro')}</p>
        {/* Decision 409: approving cancels the bookings inside the freeze. */}
        <p className="ultm8-field__hint">{t('membershipPlans.studentCard.freeze.bookingsNote')}</p>
        <Field label={t('membershipPlans.studentCard.freeze.startLabel')} htmlFor="freeze-start">
          <TextField id="freeze-start" type="date" required min={dayFromToday(0)} value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
        </Field>
        <Field label={t('membershipPlans.studentCard.freeze.endLabel')} htmlFor="freeze-end" hint={t('membershipPlans.studentCard.freeze.endHint')}>
          <TextField id="freeze-end" type="date" required min={startsAt} value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
        </Field>
        {school.data ? (
          <p className="ultm8-field__hint">{t('membershipPlans.studentCard.freeze.maxHint', { days: school.data.freezeMaxDaysPer12Months })}</p>
        ) : null}
        {fee ? <p className="ultm8-field__hint">{t('membershipPlans.studentCard.freeze.fee', { amount: formatMoney(fee, school.data?.defaultCurrency) })}</p> : null}
        <ModalActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={freeze.isPending}>
            {t('membershipPlans.studentCard.freeze.submit')}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}

function DeskModal({
  kind,
  schoolId,
  studentId,
  studentName,
  plans,
  onClose,
}: {
  kind: 'sell' | 'gift';
  schoolId: string;
  studentId: string;
  studentName: string;
  plans: MembershipPlanResponse[];
  onClose: () => void;
}) {
  const t = useT();
  const sell = useSellMembership(schoolId, studentId);
  // Decision 448 item 5: Pix only for a School in Brazil.
  const deskMethods = useDeskMethods(schoolId, DESK_PAYMENT_METHODS);
  const gift = useGiftFriendPass(schoolId, studentId);
  const [pickedPlanId, setPlanId] = useState(plans[0]?.id ?? '');
  // The plans can arrive after the window opens (or change under it): fall back
  // to the first one, as the select shows it, so the button never stays disabled.
  const planId = plans.some((p) => p.id === pickedPlanId) ? pickedPlanId : (plans[0]?.id ?? '');
  const [paymentMethod, setPaymentMethod] = useState<DeskPaymentMethod>('CASH');
  // Decision 431 (MON-15): one pass per guest, up to five in one go.
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const busy = sell.isPending || gift.isPending;
  const plan = plans.find((p) => p.id === planId);

  async function submit() {
    setError(null);
    try {
      if (kind === 'sell') await sell.mutateAsync({ membershipPlanId: planId, paymentMethod });
      else await gift.mutateAsync({ membershipPlanId: planId, quantity });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('membershipPlans.studentCard.deskFailed'));
    }
  }

  const title = kind === 'sell' ? t('membershipPlans.studentCard.sellTitle', { name: studentName }) : t('membershipPlans.studentCard.giftTitle', { name: studentName });
  return (
    <Modal title={title} onClose={onClose}>
      {plans.length === 0 ? (
        <>
          <p>{kind === 'sell' ? t('membershipPlans.studentCard.noSellablePlans') : t('membershipPlans.studentCard.noFriendPassPlans')}</p>
          <p>
            <Link to="/membership-plans/new">{t('membershipPlans.list.addPlan')}</Link>
          </p>
        </>
      ) : (
        <>
          {error ? <ErrorBanner message={error} /> : null}
          <p>{kind === 'sell' ? t('membershipPlans.studentCard.sellIntro') : t('membershipPlans.studentCard.giftIntro')}</p>
          <div className="u8n-dd-field">
            <NewLookSelect
              id="desk-plan"
              label={t('membershipPlans.studentCard.planLabel')}
              value={planId}
              onChange={setPlanId}
              options={plans.map((p) => ({
                value: p.id,
                label: kind === 'sell' ? `${p.title} (${formatMoney(p.price, p.currency)})` : p.title,
              }))}
            />
          </div>
          {kind === 'gift' ? (
            <div className="u8n-dd-field">
              <NewLookSelect
                id="desk-gift-quantity"
                label={t('membershipPlans.studentCard.giftQuantityLabel')}
                value={String(quantity)}
                onChange={(v) => setQuantity(Number(v))}
                options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
              />
              <span className="ultm8-field__hint u8n-dd-field__hint">{t('membershipPlans.studentCard.giftQuantityHint')}</span>
            </div>
          ) : null}
          {kind === 'sell' && plan && plan.price > 0 ? (
            <JoiningFeeNotice planId={plan.id} studentId={studentId} price={plan.price} currency={plan.currency ?? null} />
          ) : null}
          {kind === 'sell' && plan && plan.price > 0 ? (
            <div className="u8n-dd-field">
              <NewLookSelect
                id="desk-paid-by"
                label={t('membershipPlans.studentCard.paidByLabel')}
                value={paymentMethod}
                onChange={(v) => setPaymentMethod(v as DeskPaymentMethod)}
                options={deskMethods.map((m) => ({ value: m, label: t(PAYMENT_METHOD_LABELS[m]) }))}
              />
            </div>
          ) : null}
          <ModalActions>
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button onClick={submit} loading={busy} disabled={!planId}>
              {kind === 'sell' ? t('membershipPlans.studentCard.sellConfirm') : t('membershipPlans.studentCard.giftConfirm')}
            </Button>
          </ModalActions>
        </>
      )}
    </Modal>
  );
}
