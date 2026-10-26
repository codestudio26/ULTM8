import React from 'react';
import { SelectField } from '@ultm8/ui';
import { useAuth, useCoachSchoolId, useCoachSchoolIds, useOwnedSchoolId, useOwnedSchoolIds } from '../auth/AuthContext';
import { useSchoolNames } from '../schools/schoolQueries';
import { useT } from '../i18n/I18nProvider';

/**
 * Decision 184 item 4's own named follow-up, resolved: a coach or Branch Staff
 * member who holds an active INSTRUCTOR/BRANCH_STAFF grant at more than one
 * School can now pick which one they're currently acting as, instead of
 * silently landing on whichever School happened to sort first. Decision 255
 * found the identical gap on the Owner side (`SCHOOL_OWNER_MANAGER` at more
 * than one School) and deliberately left it for its own follow-up — this is
 * that follow-up, closed the same way.
 *
 * A caller who owns at least one School always gets the Owner nav, never the
 * Coach one (`useIsCoachOnly()`, the test Shell.tsx picks the nav with), so
 * the two switcher modes below are mutually exclusive in practice — this
 * component picks whichever one applies rather than rendering two controls.
 * Renders nothing for the common case (one School, or none, on whichever side
 * applies) — same "don't clutter the header for the normal case" judgment the
 * language picker's `languages?.length` guard makes.
 */
export function SchoolSwitcher() {
  const t = useT();
  const { setActiveCoachSchoolId, setActiveOwnedSchoolId } = useAuth();
  const ownedSchoolIds = useOwnedSchoolIds();
  const activeOwnedSchoolId = useOwnedSchoolId();
  const coachSchoolIds = useCoachSchoolIds();
  const activeCoachSchoolId = useCoachSchoolId();

  const isOwner = ownedSchoolIds.length > 0;
  const schoolIds = isOwner ? ownedSchoolIds : coachSchoolIds;
  const activeSchoolId = isOwner ? activeOwnedSchoolId : activeCoachSchoolId;
  const setActiveSchoolId = isOwner ? setActiveOwnedSchoolId : setActiveCoachSchoolId;
  const names = useSchoolNames(schoolIds);

  if (schoolIds.length < 2) return null;

  return (
    <SelectField
      aria-label={t('coach.schoolSwitcher.aria')}
      value={activeSchoolId ?? ''}
      onChange={(e) => {
        if (e.target.value) setActiveSchoolId(e.target.value);
      }}
      options={names.map((s) => ({ value: s.id, label: s.name ?? t('coach.schoolSwitcher.loading') }))}
      style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }}
    />
  );
}
