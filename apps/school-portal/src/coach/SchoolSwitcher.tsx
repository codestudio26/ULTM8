import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, useCoachSchoolId, useCoachSchoolIds, useOwnedSchoolId, useOwnedSchoolIds } from '../auth/AuthContext';
import { useSchoolNames } from '../schools/schoolQueries';
import { useT } from '../i18n/I18nProvider';
import { NewLookSelect } from '../layout/NewLookSelect';

/**
 * Decision 184 item 4's own named follow-up, resolved: a coach or Branch Staff
 * member who holds an active INSTRUCTOR/BRANCH_STAFF grant at more than one
 * School can now pick which one they're currently acting as, instead of
 * silently landing on whichever School happened to sort first. Decision 255
 * found the identical gap on the Owner side (`SCHOOL_OWNER_MANAGER` at more
 * than one School) and deliberately left it for its own follow-up — this is
 * that follow-up, closed the same way.
 *
 * A caller who owns at least one School gets the Owner nav, not the Coach one
 * (`useIsCoachOnly()`, the test Shell.tsx picks the nav with), so an owner
 * normally sees only the Schools they own. Coaches review CP4: when
 * that owner also coaches at a School they don't own, that School is listed
 * too (marked "Coach"), and picking it shows its coach screens.
 * Renders nothing for the common case (one School, or none, on whichever side
 * applies) — same "don't clutter the header for the normal case" judgment the
 * language picker's `languages?.length` guard makes.
 *
 * In the new look (Decision 453) it is the shell's own drop-down
 * (`NewLookSelect`, DESIGN.md → "Drop-downs"), never a browser `<select>`;
 * its name stays on screen readers only, as before (newLookShell.css,
 * `.u8n-bar__select`).
 */
export function SchoolSwitcher() {
  const t = useT();
  const navigate = useNavigate();
  const { setActiveCoachSchoolId, setActiveOwnedSchoolId } = useAuth();
  const ownedSchoolIds = useOwnedSchoolIds();
  const activeOwnedSchoolId = useOwnedSchoolId();
  const activeCoachSchoolId = useCoachSchoolId();
  // Coaches review CP4: an owner who also coaches at another School gets that
  // School here too, marked "Coach"; picking it shows its coach screens. A
  // School they own is only ever listed as theirs.
  const coachOnlySchoolIds = useCoachSchoolIds().filter((id) => !ownedSchoolIds.includes(id));
  const isOwner = ownedSchoolIds.length > 0;
  const names = useSchoolNames([...ownedSchoolIds, ...coachOnlySchoolIds]);
  const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? t('coach.schoolSwitcher.loading');

  if (ownedSchoolIds.length + coachOnlySchoolIds.length < 2) return null;

  const mixed = isOwner && coachOnlySchoolIds.length > 0;
  const options = [
    ...ownedSchoolIds.map((id) => ({ value: id, label: mixed ? `${nameOf(id)} · ${t('layout.roles.owner')}` : nameOf(id) })),
    ...coachOnlySchoolIds.map((id) => ({ value: id, label: mixed ? `${nameOf(id)} · ${t('layout.roles.coach')}` : nameOf(id) })),
  ];
  // The two lists never share a School, so the id alone says which side it is.
  const value = activeOwnedSchoolId ?? activeCoachSchoolId ?? '';

  return (
    <div className="u8n-bar__select">
      <NewLookSelect
        id="u8n-school-switcher"
        label={t('coach.schoolSwitcher.aria')}
        value={value}
        onChange={(id) => {
          if (!id) return;
          const toCoach = !ownedSchoolIds.includes(id);
          const wasCoach = !activeOwnedSchoolId;
          if (toCoach) setActiveCoachSchoolId(id);
          else setActiveOwnedSchoolId(id);
          // Moving between owning and coaching changes the whole menu, so start
          // again from that side's home page.
          if (wasCoach !== toCoach) navigate('/');
        }}
        options={options}
      />
    </div>
  );
}
