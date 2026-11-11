import React, { useState } from 'react';
import { Button, EmptyState, ErrorBanner, Spinner } from '@ultm8/ui';
import { TeamCard } from '../team/TeamParts';
import { NewLookSelect } from '../layout/NewLookSelect';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import type { TranslationKey } from '../i18n/I18nProvider';
import { ROLE_LABELS } from '../lib/enumLabels';
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
  // Any other role (e.g. FRANCHISE_OWNER) by its name, never the raw code.
  const role = d.role && ROLE_KEYS[d.role] ? t(ROLE_KEYS[d.role]) : d.role && ROLE_LABELS[d.role] ? t(ROLE_LABELS[d.role]!) : String(d.role ?? '');
  const at = d.branchName ? t('roleGrants.activity.atBranch', { branch: d.branchName }) : '';
  const vars = { who, whom, role, at, email: String(d.email ?? '') };
  switch (e.action) {
    case 'ROLE_GIVEN':
      return t(d.manual ? 'roleGrants.activity.roleGivenManual' : 'roleGrants.activity.roleGiven', vars);
    case 'ROLE_REMOVED':
      // Decision 433 item 6: someone gave up their own role.
      return t(d.self ? 'roleGrants.activity.steppedDown' : 'roleGrants.activity.roleRemoved', vars);
    case 'REMOVED_FROM_SCHOOL':
      return t('roleGrants.activity.removedFromSchool', vars);
    case 'PAUSED':
      // Decision 433 item 6: ULTM8 support's emergency pause.
      return t(d.byUltm8Support ? 'roleGrants.activity.pausedBySupport' : 'roleGrants.activity.paused', vars);
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
    // Decisions 303, 338: "Can create charges" and "Can cancel charges".
    case 'CHARGE_ACCESS_CHANGED': {
      const changes = (d.changes ?? []) as Array<{ switch: string; on: boolean }>;
      const list = changes
        .map((c) => t(c.on ? 'roleGrants.activity.switchOn' : 'roleGrants.activity.switchOff', { name: t(`charges.activity.${c.switch}` as TranslationKey) }))
        .join(', ');
      return t('roleGrants.activity.accessChanged', { ...vars, list });
    }
    // Decision 315 item 13: a duplicate member merged into the kept one.
    case 'MEMBERS_MERGED':
      return t('roleGrants.activity.membersMerged', { ...vars, duplicate: String(d.duplicateName ?? '') || t('roleGrants.activity.someone') });
    // Decision 430 items 6 and 8: a child's parents and guardians.
    case 'GUARDIAN_INVITED':
      return t('roleGrants.activity.guardianInvited', { ...vars, child: String(d.studentName ?? '') });
    case 'GUARDIAN_REMOVED':
      return t('roleGrants.activity.guardianRemoved', { ...vars, child: String(d.studentName ?? '') });
    case 'GUARDIAN_LEFT':
      return t('roleGrants.activity.guardianLeft', { ...vars, child: String(d.studentName ?? '') });
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
    <TeamCard title={t('roleGrants.activity.heading')} intro={t('roleGrants.activity.intro')}>
      <div className="u8t-toolbar">
        <NewLookSelect
          id="staff-activity-person"
          label={t('roleGrants.activity.personLabel')}
          value={userId}
          onChange={setUserId}
          options={[
            { value: '', label: t('roleGrants.activity.everyone') },
            ...(people.data?.items ?? []).map((p) => ({ value: p.userId, label: `${p.firstName} ${p.surname}`.trim() })),
          ]}
        />
      </div>
      {activity.isLoading ? (
        <div className="u8t-state">
          <Spinner />
        </div>
      ) : activity.error ? (
        <div className="u8t-state">
          <ErrorBanner message={activity.error instanceof ApiError ? activity.error.message : t('roleGrants.activity.loadFailed')} />
        </div>
      ) : entries.length === 0 ? (
        <div className="u8t-state">
          <EmptyState title={t('roleGrants.activity.emptyTitle')} description={t('roleGrants.activity.emptyDescription')} />
        </div>
      ) : (
        <>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }} aria-label={t('roleGrants.activity.heading')}>
            {entries.map((e) => (
              <li key={e.id} className="u8t-li">
                <span className="u8t-li__main">
                  <span>{describe(t, e)}</span>
                  <span className="u8t-sub" style={{ display: 'block' }}>
                    {when(e.createdAt)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {activity.hasNextPage ? (
            <div className="u8t-state">
              <Button variant="secondary" loading={activity.isFetchingNextPage} onClick={() => void activity.fetchNextPage()}>
                {t('roleGrants.activity.loadMore')}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </TeamCard>
  );
}
