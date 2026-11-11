import React, { useState } from 'react';
import { Checkbox, EmptyState, ErrorBanner, Spinner } from '@ultm8/ui';
import { TeamCard } from '../team/TeamParts';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { useChargePermissions, useSetChargePermission, type ChargePermission } from './chargeQueries';
import { useIsMainOwner } from '../roleGrants/roleGrantQueries';

type Pending = { canCreateCharges: boolean; canCancelCharges: boolean };

/**
 * "Can create charges" (Decision 303 item 3: on by default for Branch Staff,
 * off for coaches) and "Can cancel charges" (Decision 338 item 1: off for
 * everyone), per Branch Staff member or coach, as "Can start open mat
 * sessions" is (Decision 386). The owner always can do both. A new-look card
 * on the Staff page (Decision 453); each person's own switches are also in
 * the page's Team member panel.
 */
export function ChargePermissions({ schoolId }: { schoolId: string }) {
  const t = useT();
  const staff = useChargePermissions(schoolId);
  const save = useSetChargePermission(schoolId);
  // Decision 448 item 6: only the main owner changes these; a co-owner sees them, locked.
  const isMainOwner = useIsMainOwner(schoolId);
  const locked = isMainOwner !== true;
  const [error, setError] = useState<string | null>(null);
  // Shows the new state at once; it goes back if saving fails.
  const [saving, setSaving] = useState<Record<string, Pending>>({});

  async function toggle(person: ChargePermission, next: Pending) {
    setError(null);
    setSaving((m) => ({ ...m, [person.userId]: next }));
    try {
      await save.mutateAsync({ userId: person.userId, ...next });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('charges.permissions.saveFailed'));
    } finally {
      setSaving(({ [person.userId]: _done, ...rest }) => rest);
    }
  }

  const current = (p: ChargePermission): Pending => saving[p.userId] ?? { canCreateCharges: p.canCreateCharges, canCancelCharges: p.canCancelCharges };

  const rows = staff.data?.items ?? [];
  return (
    <TeamCard title={t('charges.permissions.heading')} intro={t('charges.permissions.intro')}>
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
          <ErrorBanner message={staff.error instanceof ApiError ? staff.error.message : t('charges.permissions.loadFailed')} />
        </div>
      ) : rows.length === 0 ? (
        <div className="u8t-state">
          <EmptyState title={t('charges.permissions.emptyTitle')} description={t('charges.permissions.emptyDescription')} />
        </div>
      ) : (
        <table className="u8t-table">
          <thead>
            <tr>
              <th scope="col">{t('charges.permissions.columnName')}</th>
              <th scope="col">{t('charges.permissions.columnCreate')}</th>
              <th scope="col">{t('charges.permissions.columnCancel')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.userId}>
                <td className="u8t-c-main">{`${p.firstName} ${p.surname}`}</td>
                <td>
                  <Checkbox
                    label={t('charges.permissions.createLabel', { name: `${p.firstName} ${p.surname}` })}
                    checked={current(p).canCreateCharges}
                    disabled={locked || p.userId in saving}
                    onChange={(e) => toggle(p, { ...current(p), canCreateCharges: e.target.checked })}
                  />
                </td>
                <td>
                  <Checkbox
                    label={t('charges.permissions.cancelLabel', { name: `${p.firstName} ${p.surname}` })}
                    checked={current(p).canCancelCharges}
                    disabled={locked || p.userId in saving}
                    onChange={(e) => toggle(p, { ...current(p), canCancelCharges: e.target.checked })}
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
