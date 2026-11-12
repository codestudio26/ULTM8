import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, EmptyState, ErrorBanner, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { formatLocale } from '../i18n/format';
import { useT } from '../i18n/I18nProvider';
import { OwnerOnly } from './MembershipPlansPage';
import { NewLookPageHeader } from '../layout/NewLookPage';
import { BillingCard, BillingPage } from '../billing/BillingLook';
import { FitTable } from '../students/StudentsSectionLook';
import './planMembers.css';
import { useMembershipPlan, usePlanMembers, usePlanWaitlist, type PlanMemberResponse } from './membershipPlanQueries';

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Who is on a plan now, with their dates (Decision 348). Owner only, like
 * the rest of Membership Plans. The same people the Active members tile
 * counts: live memberships of current Students.
 *
 * New look (Decision 460 item 17): the shell's header (its "‹ Membership
 * Plans" link replaces the old "Back to Membership Plans" line), white cards,
 * tags, and a table that becomes a card per member when it doesn't fit
 * (FitTable). The same people, dates and waiting list as before. */
export function MembershipPlanMembersPage() {
  const { id } = useParams<{ id: string }>();
  const schoolId = useOwnedSchoolId();
  const t = useT();
  const plan = useMembershipPlan(schoolId ? id ?? null : null);
  const members = usePlanMembers(schoolId ? id ?? null : null);
  // Decision 435 items 10-15: the places taken and the waiting list.
  const waitlist = usePlanWaitlist(schoolId && plan.data?.memberLimit != null ? id ?? null : null);

  if (!schoolId) return <OwnerOnly />;
  if (plan.isLoading || members.isLoading) return <Spinner />;
  const error = plan.error ?? members.error;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : t('membershipPlans.members.loadFailed')} />;

  const rows = (members.data?.items ?? []).map((m) => ({ ...m, id: m.membershipId }));
  return (
    <BillingPage>
      <NewLookPageHeader
        parent={{ to: '/membership-plans', label: t('membershipPlans.list.title') }}
        title={t('membershipPlans.members.title', { plan: plan.data?.title ?? '' })}
        subtitle={t('membershipPlans.members.subtitle', { count: rows.length })}
      />
      <BillingCard flush={rows.length > 0}>
        {rows.length === 0 ? (
          <EmptyState title={t('membershipPlans.members.emptyTitle')} description={t('membershipPlans.members.emptyDescription')} />
        ) : (
          <FitTable<PlanMemberResponse & { id: string }>
            testId="plan-members"
            rows={rows}
            columns={[
              {
                key: 'name',
                header: t('membershipPlans.members.columnName'),
                main: true,
                render: (m) => <Link to={`/students/${m.studentId}`}>{`${m.firstName} ${m.surname}`.trim()}</Link>,
              },
              { key: 'started', header: t('membershipPlans.members.columnStarted'), render: (m) => formatDay(m.startDate) },
              {
                key: 'ends',
                header: t('membershipPlans.members.columnEnds'),
                render: (m) =>
                  m.cancelAt ? (
                    <Badge variant="warning">{t('membershipPlans.members.cancelledEnds', { date: formatDay(m.cancelAt) })}</Badge>
                  ) : m.expiryDate ? (
                    formatDay(m.expiryDate)
                  ) : (
                    t('membershipPlans.members.noEnd')
                  ),
              },
              {
                key: 'classes',
                header: t('membershipPlans.members.columnClassesLeft'),
                render: (m) => (m.classesRemaining === null || m.classesRemaining === undefined ? t('membershipPlans.members.unlimited') : String(m.classesRemaining)),
              },
              { key: 'given', header: '', render: (m) => (m.gifted ? <Badge variant="info">{t('membershipPlans.members.given')}</Badge> : null) },
            ]}
          />
        )}
      </BillingCard>
      {plan.data?.memberLimit != null && waitlist.data ? (
        <BillingCard title={t('membershipPlans.members.waitlistTitle')}>
          <p className="u8b-note" data-testid="plan-places">
            {t('membershipPlans.members.limitLine', { taken: waitlist.data.placesTaken, limit: plan.data.memberLimit })}
          </p>
          {waitlist.data.items.length === 0 ? (
            <p className="u8pm-plain">{t('membershipPlans.members.waitlistEmpty')}</p>
          ) : (
            <ol data-testid="plan-waitlist" className="u8pm-waitlist">
              {waitlist.data.items.map((e) => (
                <li key={e.id}>
                  <Link to={`/students/${e.studentId}`}>{`${e.firstName} ${e.surname}`.trim()}</Link>
                  {' · '}
                  {e.status === 'OFFERED' && e.offerExpiresAt
                    ? t('membershipPlans.members.waitlistHeld', { date: new Date(e.offerExpiresAt).toLocaleString(formatLocale()) })
                    : t('membershipPlans.members.waitlistWaiting', { date: formatDay(e.joinedAt) })}
                </li>
              ))}
            </ol>
          )}
        </BillingCard>
      ) : null}
    </BillingPage>
  );
}
