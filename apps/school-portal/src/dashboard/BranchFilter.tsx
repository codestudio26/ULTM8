import React from 'react';
import { Field, SelectField } from '@ultm8/ui';
import { useBranches } from '../branches/branchQueries';
import { useT } from '../i18n/I18nProvider';

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
    <div style={{ minWidth: 200 }}>
      <Field label={t('dashboard.branchLabel')} htmlFor="dashboard-branch-filter">
        <SelectField
          id="dashboard-branch-filter"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          options={[{ value: '', label: t('dashboard.branchAll') }, ...open.map((b) => ({ value: b.id, label: b.name }))]}
        />
      </Field>
    </div>
  );
}
