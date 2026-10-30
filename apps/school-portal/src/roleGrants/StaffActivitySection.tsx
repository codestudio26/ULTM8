import React, { useState } from 'react';
import { Button, Card, EmptyState, ErrorBanner, Field, SelectField, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import type { TranslationKey } from '../i18n/I18nProvider';
import { useStaffActivity, useStaffList, type StaffActivityEntry } from './roleGrantQueries';

type T = ReturnType<typeof useT>;

const ROLE_KEYS: Record<string, TranslationKey> = {
  INSTRUCTOR: 'roleGrants.staff.roleInstructor',
  BRANCH_STAFF: 'roleGrants.staff.roleBranchStaff',
  SCHOOL_OWNER_MANAGER: 'roleGrants.staff.roleCoOwner',
};

/** One log line as a sentence. Unknown actions (a newer API) fall back to a
 * plain "made a change". */
function describe(t: T, e: StaffActivityEntry): string {
  const d = (e.details ?? {}) as Record<string, any>;
  const who = e.actorName ?? t('roleGrants.activity.someone');
  const whom = e.targetName ?? t('roleGrants.activity.someone');
  const role = d.role && ROLE_KEYS[d.role] ? t(ROLE_KEYS[d.role]) : String(d.role ?? '');
  const at = d.branchName ? t('roleGrants.activity.atBranch', { branch: d.branchName }) : '';
  const vars = { who, whom, role, at, email: String(d.email ?? '') };
  switch (e.action) {
    case 'ROLE_GIVEN':
      return t(d.manual ? 'roleGrants.activity.roleGivenManual' : 'roleGrants.activity.roleGiven', vars);
    case 'ROLE_REMOVED':
      return t('roleGrants.activity.roleRemoved', vars);
    case 'REMOVED_FROM_SCHOOL':
      return t('roleGrants.activity.removedFromSchool', vars);
    case 'PAUSED':
      return t('roleGrants.activity.paused', vars);
    case 'UNPAUSED':
      return t('roleGrants.activity.unpaused', vars);
    case 'ACCESS_CHANGED': {
      const changes = (d.changes ?? []) as Array<{ switch: string; on: boolean }>;
      const list = changes
        .map((c) => t(c.on ? 'roleGrants.activity.switchOn' : 'roleGrants.activity.switchOff', { name: t(`roleGrants.access.${c.switch}` as TranslationKey) }))
        .join(', ');
      return t('roleGrants.activity.accessChanged', { ...vars, list });
    }
    case 'DETAILS_CHANGED':
      return t('roleGrants.activity.detailsChanged', vars);
    case 'MAIN_OWNER_HANDED_OVER':
      return t('roleGrants.activity.mainOwner', vars);
    case 'INVITE_SENT':
      return t('roleGrants.activity.inviteSent', vars);
    case 'INVITE_CANCELLED':
      return t('roleGrants.activity.inviteCancelled', vars);
    case 'INVITE_ACCEPTED':
      return t('roleGrants.activity.inviteAccepted', vars);
    case 'OPEN_MAT_CHANGED':
      return t(d.on ? 'roleGrants.activity.openMatOn' : 'roleGrants.activity.openMatOff', vars);
    case 'SETTING_CHANGED':
      return t(d.mustAcceptFirst ? 'roleGrants.activity.mustAcceptOn' : 'roleGrants.activity.mustAcceptOff', vars);
    default:
      return t('roleGrants.activity.changed', vars);
  }
}

/**
 * The Staff page's activity log (Decision 408): who changed what on this
 * page, newest first, with a filter by person. Owners and co-owners only;
 * it starts from the day it went live.
 */
export function StaffActivitySection({ schoolId }: { schoolId: string }) {
  const t = useT();
  const [userId, setUserId] = useState('');
  const people = useStaffList(schoolId, { status: 'all' });
  const activity = useStaffActivity(schoolId, userId);
  const entries = activity.data?.pages.flatMap((p) => p.items) ?? [];
  const when = (iso: string) =>
    new Date(iso).toLocaleString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <Card className="ultm8-field">
      <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
        {t('roleGrants.activity.heading')}
      </h2>
      <p style={{ marginTop: 0 }}>{t('roleGrants.activity.intro')}</p>
      <Field label={t('roleGrants.activity.personLabel')} htmlFor="staff-activity-person">
        <SelectField
          id="staff-activity-person"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          options={[
            { value: '', label: t('roleGrants.activity.everyone') },
            ...(people.data?.items ?? []).map((p) => ({ value: p.userId, label: `${p.firstName} ${p.surname}`.trim() })),
          ]}
        />
      </Field>
      {activity.isLoading ? (
        <Spinner />
      ) : activity.error ? (
        <ErrorBanner message={activity.error instanceof ApiError ? activity.error.message : t('roleGrants.activity.loadFailed')} />
      ) : entries.length === 0 ? (
        <EmptyState title={t('roleGrants.activity.emptyTitle')} description={t('roleGrants.activity.emptyDescription')} />
      ) : (
        <>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} aria-label={t('roleGrants.activity.heading')}>
            {entries.map((e) => (
              <li key={e.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--ultm8-border, #e5e7eb)' }}>
                <div>{describe(t, e)}</div>
                <div style={{ fontSize: 13, opacity: 0.75 }}>{when(e.createdAt)}</div>
              </li>
            ))}
          </ul>
          {activity.hasNextPage ? (
            <Button variant="secondary" loading={activity.isFetchingNextPage} onClick={() => void activity.fetchNextPage()} style={{ marginTop: 12 }}>
              {t('roleGrants.activity.loadMore')}
            </Button>
          ) : null}
        </>
      )}
    </Card>
  );
}
