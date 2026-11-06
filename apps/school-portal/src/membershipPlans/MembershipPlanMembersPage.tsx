import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { formatLocale } from '../i18n/format';
import { useT } from '../i18n/I18nProvider';
import { OwnerOnly } from './MembershipPlansPage';
import { useMembershipPlan, usePlanMembers, usePlanWaitlist, type PlanMemberResponse } from './membershipPlanQueries';

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Who is on a plan now, with their dates (Decision 348). Owner only, like
 * the rest of Membership Plans. The same people the Active members tile
 * counts: live memberships of current Students. */
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
    <>
      <p style={{ margin: '0 0 8px' }}>
        <Link to="/membership-plans">{t('membershipPlans.members.back')}</Link>
      </p>
      <PageHeader
        title={t('membershipPlans.members.title', { plan: plan.data?.title ?? '' })}
        subtitle={t('membershipPlans.members.subtitle', { count: rows.length })}
      />
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={t('membershipPlans.members.emptyTitle')} description={t('membershipPlans.members.emptyDescription')} />
        ) : (
          <Table<PlanMemberResponse & { id: string }>
            rows={rows}
            columns={[
              {
                key: 'name',
                header: t('membershipPlans.members.columnName'),
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
      </Card>
      {plan.data?.memberLimit != null && waitlist.data ? (
        <Card>
          <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('membershipPlans.members.waitlistTitle')}</h2>
          <p style={{ color: 'var(--text-muted)', margin: '0 0 12px' }} data-testid="plan-places">
            {t('membershipPlans.members.limitLine', { taken: waitlist.data.placesTaken, limit: plan.data.memberLimit })}
          </p>
          {waitlist.data.items.length === 0 ? (
            <p style={{ margin: 0 }}>{t('membershipPlans.members.waitlistEmpty')}</p>
          ) : (
            <ol data-testid="plan-waitlist" style={{ margin: 0, paddingInlineStart: 20 }}>
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
        </Card>
      ) : null}
    </>
  );
}

