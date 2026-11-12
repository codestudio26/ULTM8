import React from 'react';
import { useBranches } from '../branches/branchQueries';
import { useT } from '../i18n/I18nProvider';
import { NewLookSelect } from '../layout/NewLookSelect';

/**
 * Decision 367 (Q5) — narrows the Dashboard and the Bookings page to one
 * Branch. Shown only when the School has two or more open Branches; "All
 * Branches" (the default) also counts School-wide Classes with no Branch.
 */
export function BranchFilter({ schoolId, value, onChange }: { schoolId: string; value: string; onChange: (branchId: string) => void }) {
  const t = useT();
  const { data } = useBranches(schoolId);
  const open = (data?.items ?? []).filter((b) => !b.archivedAt);
  if (open.length < 2 && !value) return null;
  return (
    <div className="u8n-dd-field">
      <NewLookSelect
        id="dashboard-branch-filter"
        label={t('dashboard.branchLabel')}
        value={value}
        onChange={onChange}
        options={[{ value: '', label: t('dashboard.branchAll') }, ...open.map((b) => ({ value: b.id, label: b.name }))]}
      />
    </div>
  );
}
