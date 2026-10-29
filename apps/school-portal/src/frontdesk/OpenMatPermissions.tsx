import React, { useState } from 'react';
import { Card, Checkbox, EmptyState, ErrorBanner, Spinner, Table } from '@ultm8/ui';
import { useT } from '../i18n/I18nProvider';
import { errorText } from './frontDeskQueries';
import { useOpenMatPermissions, useSetOpenMatPermission, type OpenMatPermission } from './openMatQueries';

/** "Can start open mat sessions", per Branch Staff member or coach (Decision
 * 304 item 4, built as Decision 386). Off by default; the owner always can. */
export function OpenMatPermissions({ schoolId }: { schoolId: string }) {
  const t = useT();
  const staff = useOpenMatPermissions(schoolId);
  const setAllowed = useSetOpenMatPermission(schoolId);
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

  return (
    <Card className="ultm8-field">
      <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
        {t('frontDesk.openMatPermissions.heading')}
      </h2>
      <p style={{ marginTop: 0 }}>{t('frontDesk.openMatPermissions.intro')}</p>
      {error ? <ErrorBanner message={error} /> : null}
      {staff.isLoading ? (
        <Spinner />
      ) : staff.error ? (
        <ErrorBanner message={errorText(staff.error, t('frontDesk.openMatPermissions.loadFailed'))} />
      ) : (staff.data?.items ?? []).length === 0 ? (
        <EmptyState title={t('frontDesk.openMatPermissions.emptyTitle')} description={t('frontDesk.openMatPermissions.emptyDescription')} />
      ) : (
        <Table<OpenMatPermission & { id: string }>
          rows={staff.data!.items.map((p) => ({ ...p, id: p.userId }))}
          columns={[
            { key: 'name', header: t('frontDesk.openMatPermissions.columnName'), render: (p) => `${p.firstName} ${p.surname}` },
            {
              key: 'allowed',
              header: t('frontDesk.openMatPermissions.columnAllowed'),
              render: (p) => (
                <Checkbox
                  label={t('frontDesk.openMatPermissions.checkboxLabel', { name: `${p.firstName} ${p.surname}` })}
                  checked={saving[p.userId] ?? p.canStartOpenMat}
                  disabled={p.userId in saving}
                  onChange={(e) => toggle(p, e.target.checked)}
                />
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}
