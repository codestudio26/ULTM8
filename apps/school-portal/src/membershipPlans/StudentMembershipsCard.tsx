import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, SelectField, Spinner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
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
  useSellMembership,
  useStudentMemberships,
  type DeskPaymentMethod,
  type MembershipPlanResponse,
  type StudentMembershipResponse,
} from './membershipPlanQueries';
import { FREEZABLE_TYPES, dayFromToday, formatCalendarDay, useFreezeAction, useFreezeMembership } from './freezeQueries';
import { useSchool } from '../schools/schoolQueries';

const TYPE_LABELS: Record<string, TranslationKey> = {
  SUBSCRIPTION: 'membershipPlans.types.subscription',
  CLASS_PACK: 'membershipPlans.types.classPack',
  WEEKLY_PASS: 'membershipPlans.types.weeklyPass',
  FRIEND_PASS: 'membershipPlans.types.friendPass',
  TRIAL_MEMBERSHIP: 'membershipPlans.types.trialMembership',
  VISIT_PASS: 'membershipPlans.types.visitPass',
};

/** Plans the owner can sell at the desk: not a Subscription (card only) or a
 * Friend Pass (given, not sold). */
const DESK_TYPES = ['CLASS_PACK', 'WEEKLY_PASS', 'TRIAL_MEMBERSHIP'];

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * The owner's view of one Student's memberships (Decision 348): what they
 * hold, selling a plan at the desk (cash, bank transfer, Pix or card
 * terminal), giving a Friend
 * Pass, and cancelling a Subscription at the end of its paid month.
 */
export function StudentMembershipsCard({ schoolId, studentId, studentName }: { schoolId: string; studentId: string; studentName: string }) {
  const t = useT();
  const memberships = useStudentMemberships(schoolId, studentId);
  const plans = useMembershipPlans(schoolId);
  const cancel = useCancelMembership(schoolId, studentId);
  const [dialog, setDialog] = useState<'sell' | 'gift' | null>(null);
  const [cancelling, setCancelling] = useState<StudentMembershipResponse | null>(null);
  // Decision 404: freezing a membership.
  const [freezing, setFreezing] = useState<StudentMembershipResponse | null>(null);
  const [ending, setEnding] = useState<StudentMembershipResponse | null>(null);
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
  const sellable = activePlans.filter((p) => DESK_TYPES.includes(p.type));
  const friendPasses = activePlans.filter((p) => p.type === 'FRIEND_PASS');

  function statusOf(m: StudentMembershipResponse) {
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

  function detailsOf(m: StudentMembershipResponse) {
    const parts: string[] = [];
    if (m.classesRemaining !== null && m.classesRemaining !== undefined) parts.push(t('membershipPlans.studentCard.classesLeft', { count: m.classesRemaining }));
    if (m.expiryDate) parts.push(t('membershipPlans.studentCard.expires', { date: formatDay(m.expiryDate) }));
    if (m.giftedById) parts.push(t('membershipPlans.studentCard.given'));
    if (m.frozen && m.planType === 'SUBSCRIPTION') parts.push(t('membershipPlans.studentCard.freeze.billingPaused'));
    return parts.join(' · ') || t('common.none');
  }

  return (
    <div style={{ marginBottom: 24 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
          <h2 className="ultm8-page-header__title" style={{ fontSize: 15, margin: 0 }}>
            {t('membershipPlans.studentCard.title')}
          </h2>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={() => setDialog('sell')}>
              {t('membershipPlans.studentCard.sell')}
            </Button>
            <Button variant="secondary" onClick={() => setDialog('gift')}>
              {t('membershipPlans.studentCard.gift')}
            </Button>
          </div>
        </div>
        {memberships.isLoading ? (
          <Spinner />
        ) : memberships.error ? (
          <ErrorBanner message={memberships.error instanceof ApiError ? memberships.error.message : t('membershipPlans.studentCard.loadFailed')} />
        ) : null}
        {freezeError ? <ErrorBanner message={freezeError} /> : null}
        {memberships.isLoading || memberships.error ? null : (memberships.data?.items ?? []).length === 0 ? (
          <EmptyState title={t('membershipPlans.studentCard.emptyTitle')} description={t('membershipPlans.studentCard.emptyDescription')} />
        ) : (
          <Table<StudentMembershipResponse>
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
                    {m.planType === 'SUBSCRIPTION' && m.live && !m.cancelAt ? (
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
      </Card>

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
    </div>
  );
}

/**
 * Decision 404: the owner freezes a membership straight away. At least 7 days,
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
  membership: StudentMembershipResponse;
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
        <p style={{ marginTop: 0 }}>{t('membershipPlans.studentCard.freeze.intro')}</p>
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
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" loading={freeze.isPending}>
            {t('membershipPlans.studentCard.freeze.submit')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
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
  const gift = useGiftFriendPass(schoolId, studentId);
  const [planId, setPlanId] = useState(plans[0]?.id ?? '');
  const [paymentMethod, setPaymentMethod] = useState<DeskPaymentMethod>('CASH');
  const [error, setError] = useState<string | null>(null);
  const busy = sell.isPending || gift.isPending;
  const plan = plans.find((p) => p.id === planId);

  async function submit() {
    setError(null);
    try {
      if (kind === 'sell') await sell.mutateAsync({ membershipPlanId: planId, paymentMethod });
      else await gift.mutateAsync({ membershipPlanId: planId });
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
          <p style={{ marginTop: 0 }}>{kind === 'sell' ? t('membershipPlans.studentCard.noSellablePlans') : t('membershipPlans.studentCard.noFriendPassPlans')}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <Link to="/membership-plans/new">{t('membershipPlans.list.addPlan')}</Link>
          </div>
        </>
      ) : (
        <>
          {error ? <ErrorBanner message={error} /> : null}
          <p style={{ marginTop: 0 }}>{kind === 'sell' ? t('membershipPlans.studentCard.sellIntro') : t('membershipPlans.studentCard.giftIntro')}</p>
          <Field label={t('membershipPlans.studentCard.planLabel')} htmlFor="desk-plan">
            <SelectField
              id="desk-plan"
              value={planId}
              onChange={(e) => setPlanId(e.target.value)}
              options={plans.map((p) => ({
                value: p.id,
                label: kind === 'sell' ? `${p.title} (${formatMoney(p.price, p.currency)})` : p.title,
              }))}
            />
          </Field>
          {kind === 'sell' && plan && plan.price > 0 ? (
            <Field label={t('membershipPlans.studentCard.paidByLabel')} htmlFor="desk-paid-by">
              <SelectField
                id="desk-paid-by"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as DeskPaymentMethod)}
                options={DESK_PAYMENT_METHODS.map((m) => ({ value: m, label: t(PAYMENT_METHOD_LABELS[m]) }))}
              />
            </Field>
          ) : null}
          <div style={{ display: 'flex', gap: 8 }}>
            <Button onClick={submit} loading={busy} disabled={!planId}>
              {kind === 'sell' ? t('membershipPlans.studentCard.sellConfirm') : t('membershipPlans.studentCard.giftConfirm')}
            </Button>
            <Button variant="secondary" onClick={onClose}>
              {t('common.cancel')}
            </Button>
          </div>
        </>
      )}
    </Modal>
  );
}
