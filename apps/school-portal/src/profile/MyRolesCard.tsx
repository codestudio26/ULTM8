import React, { useState } from 'react';
import { Button, Card } from '@ultm8/ui';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useCurrentUser } from '../auth/currentUserQueries';
import { useBranches } from '../branches/branchQueries';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { useIsMainOwner, useRevokeRoleGrant, useUserRoleGrants, type RoleGrantResponse } from '../roleGrants/roleGrantQueries';

const ROLE_KEYS: Record<string, TranslationKey> = {
  SCHOOL_OWNER_MANAGER: 'roleGrants.staff.roleCoOwner',
  INSTRUCTOR: 'roleGrants.staff.roleInstructor',
  BRANCH_STAFF: 'roleGrants.staff.roleBranchStaff',
};

/**
 * Decision 433 item 6 (amends Decision 423 item 10): a co-owner, coach or
 * Branch Staff member gives up their own role at the School they're working
 * in. The main owner's role is never listed: it can't be given up here
 * (Decision 370). The API refuses a coach who still teaches upcoming classes
 * there, with what to do; the message shows in the confirm dialog.
 */
export function MyRolesCard() {
  const t = useT();
  const schoolId = useGradingSchoolId();
  const { data: me } = useCurrentUser();
  const grants = useUserRoleGrants(schoolId && me ? me.id : null);
  const isMainOwner = useIsMainOwner(schoolId);
  const branches = useBranches(schoolId);
  const revoke = useRevokeRoleGrant();
  const [confirming, setConfirming] = useState<{ grant: RoleGrantResponse; label: string } | null>(null);
  if (!schoolId || !me || !grants.data || isMainOwner === undefined) return null;

  const mine = grants.data.items.filter(
    (g) => g.schoolId === schoolId && !g.revokedAt && ROLE_KEYS[g.role] && !(g.role === 'SCHOOL_OWNER_MANAGER' && isMainOwner),
  );
  if (mine.length === 0) return null;
  const branchName = (id: string | null | undefined) => (id ? branches.data?.items.find((b) => b.id === id)?.name : undefined);
  const label = (g: RoleGrantResponse) => {
    const branch = branchName(g.branchId);
    return `${t(ROLE_KEYS[g.role])}${branch ? t('roleGrants.activity.atBranch', { branch }) : ''}`;
  };

  return (
    <Card>
      <section aria-label={t('roleGrants.staff.myRolesTitle')}>
        <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{t('roleGrants.staff.myRolesTitle')}</h2>
        <p style={{ color: 'var(--text-muted)', margin: '0 0 16px' }}>{t('roleGrants.staff.myRolesIntro')}</p>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
          {mine.map((g) => (
            <li key={g.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
              <span>{label(g)}</span>
              <Button type="button" variant="secondary" onClick={() => setConfirming({ grant: g, label: label(g) })}>
                {t('roleGrants.staff.stepDown')}
              </Button>
            </li>
          ))}
        </ul>
      </section>
      {confirming ? (
        <ConfirmDeleteModal
          title={t('roleGrants.staff.stepDownTitle', { role: confirming.label })}
          description={t('roleGrants.staff.stepDownDescription')}
          confirmLabel={t('roleGrants.staff.stepDown')}
          genericErrorMessage={t('roleGrants.staff.stepDownFailed')}
          onConfirm={async () => {
            await revoke.mutateAsync({ targetUserId: me.id, roleGrantId: confirming.grant.id });
            // Their access changed: the next request carries the new roles.
            window.location.reload();
          }}
          onClose={() => setConfirming(null)}
        />
      ) : null}
    </Card>
  );
}
