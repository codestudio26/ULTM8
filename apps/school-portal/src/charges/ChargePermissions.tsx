import React, { useState } from 'react';
import { Card, Checkbox, EmptyState, ErrorBanner, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { useChargePermissions, useSetChargePermission, type ChargePermission } from './chargeQueries';

type Pending = { canCreateCharges: boolean; canCancelCharges: boolean };

/**
 * "Can create charges" (Decision 303 item 3: on by default for Branch Staff,
 * off for coaches) and "Can cancel charges" (Decision 338 item 1: off for
 * everyone), per Branch Staff member or coach, as "Can start open mat
 * sessions" is (Decision 386). The owner always can do both.
 */
export function ChargePermissions({ schoolId }: { schoolId: string }) {
  const t = useT();
  const staff = useChargePermissions(schoolId);
  const save = useSetChargePermission(schoolId);
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

  return (
    <Card className="ultm8-field">
      <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
        {t('charges.permissions.heading')}
      </h2>
      <p style={{ marginTop: 0 }}>{t('charges.permissions.intro')}</p>
      {error ? <ErrorBanner message={error} /> : null}
      {staff.isLoading ? (
        <Spinner />
      ) : staff.error ? (
        <ErrorBanner message={staff.error instanceof ApiError ? staff.error.message : t('charges.permissions.loadFailed')} />
      ) : (staff.data?.items ?? []).length === 0 ? (
        <EmptyState title={t('charges.permissions.emptyTitle')} description={t('charges.permissions.emptyDescription')} />
      ) : (
        <Table<ChargePermission & { id: string }>
          rows={staff.data!.items.map((p) => ({ ...p, id: p.userId }))}
          columns={[
            { key: 'name', header: t('charges.permissions.columnName'), render: (p) => `${p.firstName} ${p.surname}` },
            {
              key: 'create',
              header: t('charges.permissions.columnCreate'),
              render: (p) => (
                <Checkbox
                  label={t('charges.permissions.createLabel', { name: `${p.firstName} ${p.surname}` })}
                  checked={current(p).canCreateCharges}
                  disabled={p.userId in saving}
                  onChange={(e) => toggle(p, { ...current(p), canCreateCharges: e.target.checked })}
                />
              ),
            },
            {
              key: 'cancel',
              header: t('charges.permissions.columnCancel'),
              render: (p) => (
                <Checkbox
                  label={t('charges.permissions.cancelLabel', { name: `${p.firstName} ${p.surname}` })}
                  checked={current(p).canCancelCharges}
                  disabled={p.userId in saving}
                  onChange={(e) => toggle(p, { ...current(p), canCancelCharges: e.target.checked })}
                />
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}
