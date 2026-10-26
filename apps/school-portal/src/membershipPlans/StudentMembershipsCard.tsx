import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, SelectField, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { formatMoney } from '../lib/money';
import { formatLocale } from '../i18n/format';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import {
  useCancelMembership,
  useGiftFriendPass,
  useMembershipPlans,
  useSellMembership,
  useStudentMemberships,
  type MembershipPlanResponse,
  type StudentMembershipResponse,
} from './membershipPlanQueries';

const TYPE_LABELS: Record<string, TranslationKey> = {
  SUBSCRIPTION: 'membershipPlans.types.subscription',
  CLASS_PACK: 'membershipPlans.types.classPack',
  WEEKLY_PASS: 'membershipPlans.types.weeklyPass',
  FRIEND_PASS: 'membershipPlans.types.friendPass',
  TRIAL_MEMBERSHIP: 'membershipPlans.types.trialMembership',
};

/** Plans the owner can sell at the desk: not a Subscription (card only) or a
 * Friend Pass (given, not sold). */
const DESK_TYPES = ['CLASS_PACK', 'WEEKLY_PASS', 'TRIAL_MEMBERSHIP'];

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * The owner's view of one Student's memberships (Decision NNN): what they
 * hold, selling a plan at the desk (cash or bank transfer), giving a Friend
 * Pass, and cancelling a Subscription at the end of its paid month.
 */
export function StudentMembershipsCard({ schoolId, studentId, studentName }: { schoolId: string; studentId: string; studentName: string }) {
  const t = useT();
  const memberships = useStudentMemberships(schoolId, studentId);
  const plans = useMembershipPlans(schoolId);
  const cancel = useCancelMembership(schoolId, studentId);
  const [dialog, setDialog] = useState<'sell' | 'gift' | null>(null);
  const [cancelling, setCancelling] = useState<StudentMembershipResponse | null>(null);

  const activePlans = (plans.data?.items ?? []).filter((p) => !p.archivedAt);
  const sellable = activePlans.filter((p) => DESK_TYPES.includes(p.type));
  const friendPasses = activePlans.filter((p) => p.type === 'FRIEND_PASS');

  function statusOf(m: StudentMembershipResponse) {
    if (!m.live) return <Badge variant="default">{t('membershipPlans.studentCard.ended')}</Badge>;
    if (m.cancelAt) return <Badge variant="warning">{t('membershipPlans.studentCard.endsOn', { date: formatDay(m.cancelAt) })}</Badge>;
    return <Badge variant="success">{t('membershipPlans.studentCard.active')}</Badge>;
  }

  function detailsOf(m: StudentMembershipResponse) {
    const parts: string[] = [];
    if (m.classesRemaining !== null && m.classesRemaining !== undefined) parts.push(t('membershipPlans.studentCard.classesLeft', { count: m.classesRemaining }));
    if (m.expiryDate) parts.push(t('membershipPlans.studentCard.expires', { date: formatDay(m.expiryDate) }));
    if (m.giftedById) parts.push(t('membershipPlans.studentCard.given'));
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
        ) : (memberships.data?.items ?? []).length === 0 ? (
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
                render: (m) =>
                  m.planType === 'SUBSCRIPTION' && m.live && !m.cancelAt ? (
                    <Button variant="secondary" onClick={() => setCancelling(m)}>
                      {t('membershipPlans.studentCard.cancel')}
                    </Button>
                  ) : null,
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
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'BANK_TRANSFER'>('CASH');
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
                onChange={(e) => setPaymentMethod(e.target.value as 'CASH' | 'BANK_TRANSFER')}
                options={[
                  { value: 'CASH', label: t('membershipPlans.studentCard.cash') },
                  { value: 'BANK_TRANSFER', label: t('membershipPlans.studentCard.bankTransfer') },
                ]}
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
