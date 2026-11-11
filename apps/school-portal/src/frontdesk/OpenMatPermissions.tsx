import React, { useState } from 'react';
import { Checkbox, EmptyState, ErrorBanner, Spinner } from '@ultm8/ui';
import { TeamCard } from '../team/TeamParts';
import { useT } from '../i18n/I18nProvider';
import { errorText } from './frontDeskQueries';
import { useOpenMatPermissions, useSetOpenMatPermission, type OpenMatPermission } from './openMatQueries';
import { useIsMainOwner } from '../roleGrants/roleGrantQueries';

/** "Can start open mat sessions", per Branch Staff member or coach (Decision
 * 304 item 4, built as Decision 386). Off by default; the owner always can.
 * A new-look card on the Staff page (Decision 453); each person's own switch
 * is also in the page's Team member panel. */
export function OpenMatPermissions({ schoolId }: { schoolId: string }) {
  const t = useT();
  const staff = useOpenMatPermissions(schoolId);
  const setAllowed = useSetOpenMatPermission(schoolId);
  // Decision 448 item 6: only the main owner changes these; a co-owner sees them, locked.
  const isMainOwner = useIsMainOwner(schoolId);
  const [error, setError] = useState<string | null>(null);
  // Shows the new state at once; it goes back if saving fails.
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  async function toggle(person: OpenMatPermission, canStartOpenMat: boolean) {
    setError(null);
    setSaving((m) => ({ ...m, [person.userId]: canStartOpenMat }));
    try {
      await setAllowed.mutateAsync({ userId: person.userId, canStartOpenMat });
    } catch (err) {
      setError(errorText(err, t('frontDesk.openMatPermissions.saveFailed')));
    } finally {
      setSaving(({ [person.userId]: _done, ...rest }) => rest);
    }
  }

  const rows = staff.data?.items ?? [];
  return (
    <TeamCard title={t('frontDesk.openMatPermissions.heading')} intro={t('frontDesk.openMatPermissions.intro')}>
      {isMainOwner === false || error ? (
        <div className="u8t-banners">
          {isMainOwner === false ? <p className="u8t-hint" style={{ marginTop: 0 }}>{t('roleGrants.staff.switchesMainOwnerOnly')}</p> : null}
          {error ? <ErrorBanner message={error} /> : null}
        </div>
      ) : null}
      {staff.isLoading ? (
        <div className="u8t-state">
          <Spinner />
        </div>
      ) : staff.error ? (
        <div className="u8t-state">
          <ErrorBanner message={errorText(staff.error, t('frontDesk.openMatPermissions.loadFailed'))} />
        </div>
      ) : rows.length === 0 ? (
        <div className="u8t-state">
          <EmptyState title={t('frontDesk.openMatPermissions.emptyTitle')} description={t('frontDesk.openMatPermissions.emptyDescription')} />
        </div>
      ) : (
        <table className="u8t-table">
          <thead>
            <tr>
              <th scope="col">{t('frontDesk.openMatPermissions.columnName')}</th>
              <th scope="col">{t('frontDesk.openMatPermissions.columnAllowed')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.userId}>
                <td className="u8t-c-main">{`${p.firstName} ${p.surname}`}</td>
                <td>
                  <Checkbox
                    label={t('frontDesk.openMatPermissions.checkboxLabel', { name: `${p.firstName} ${p.surname}` })}
                    checked={saving[p.userId] ?? p.canStartOpenMat}
                    disabled={isMainOwner !== true || p.userId in saving}
                    onChange={(e) => toggle(p, e.target.checked)}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </TeamCard>
  );
}
