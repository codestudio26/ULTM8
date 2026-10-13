import React from 'react';
import { SelectField } from '@ultm8/ui';
import { useAuth, useCoachSchoolId, useCoachSchoolIds, useOwnedSchoolId } from '../auth/AuthContext';
import { useSchoolNames } from '../schools/schoolQueries';

/**
 * Decision 184 item 4's own named follow-up, resolved: a coach or Branch Staff
 * member who holds an active INSTRUCTOR/BRANCH_STAFF grant at more than one
 * School can now pick which one they're currently acting as, instead of
 * silently landing on whichever School happened to sort first.
 *
 * Renders nothing for the common case (one School, or none) — same "don't
 * clutter the header for the normal case" judgment `TopBar`'s own disabled
 * search box doesn't apply, but the language picker's `languages?.length`
 * guard does. Owners aren't shown this control: `useOwnedSchoolId` doesn't
 * route through the same active-selection mechanism (see that hook's own
 * comment in AuthContext.tsx — a School Owner holding SCHOOL_OWNER_MANAGER at
 * more than one School has the identical underlying gap, found while
 * building this, but it's a separate, not-yet-approved piece of work, not
 * silently folded into this one).
 */
export function SchoolSwitcher() {
  const { setActiveCoachSchoolId } = useAuth();
  const ownedSchoolId = useOwnedSchoolId();
  const schoolIds = useCoachSchoolIds();
  const activeSchoolId = useCoachSchoolId();
  const names = useSchoolNames(schoolIds);

  if (ownedSchoolId || schoolIds.length < 2) return null;

  return (
    <SelectField
      aria-label="Switch School"
      value={activeSchoolId ?? ''}
      onChange={(e) => {
        if (e.target.value) setActiveCoachSchoolId(e.target.value);
      }}
      options={names.map((s) => ({ value: s.id, label: s.name ?? 'Loading…' }))}
      style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }}
    />
  );
}
