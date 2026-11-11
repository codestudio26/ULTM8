import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { ErrorBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { Avatar } from '../lib/Avatar';
import { useT } from '../i18n/I18nProvider';
import { useIsMainOwner } from '../roleGrants/roleGrantQueries';
import { useChargePermissions, useSetChargePermission } from '../charges/chargeQueries';
import { useOpenMatPermissions, useSetOpenMatPermission } from '../frontdesk/openMatQueries';
import { errorText as openMatErrorText } from '../frontdesk/frontDeskQueries';
import { useSchoolInstructorBelts } from '../instructors/instructorBeltQueries';
import { useRanks } from '../ranks/rankQueries';
import { flattenLadder } from '../grading/ladder';
import { BeltChip } from '../grading/BeltChip';
import { useSchool } from '../schools/schoolQueries';
import { NewLookPageHeader } from '../layout/NewLookPage';
import './teamLook.css';

/**
 * Pieces the Team pages share in the new look (Decision 453; DESIGN.md →
 * "Team member full page"): Instructors, Staff and the team member's own
 * page. Layout only: each reads and saves exactly what the page it replaces
 * did, with the same permission checks.
 */

/** A white card with a heading bar: the heading, an optional link or button
 * on the right, and an optional grey line under them. */
export function TeamCard({
  title,
  action,
  intro,
  danger = false,
  label,
  children,
}: {
  title: React.ReactNode;
  action?: React.ReactNode;
  intro?: React.ReactNode;
  danger?: boolean;
  /** The section's accessible name, when the heading alone isn't enough. */
  label?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className={'u8t-card' + (danger ? ' u8t-card--danger' : '')} aria-label={label}>
      <div className="u8t-cardbar">
        <h2>{title}</h2>
        {action}
        {intro ? <p className="u8t-cardbar__intro">{intro}</p> : null}
      </div>
      {children}
    </section>
  );
}

/** A person's photo or initials in a circle: 40px in a list row (44px on a
 * phone), 64px at the top of a panel (DESIGN.md → "Avatars"). */
export function TeamAvatar({ firstName, surname, photoUrl, large = false }: { firstName: string; surname: string; photoUrl?: string | null; large?: boolean }) {
  return (
    <span className={'u8t-avatar' + (large ? ' u8t-avatar--lg' : '')}>
      <Avatar firstName={firstName} surname={surname} photoUrl={photoUrl ?? null} size={large ? 64 : 40} />
    </span>
  );
}

/** The top of the right-hand panel: the 64px avatar and the name. */
export function TeamPanelWho({ firstName, surname, photoUrl, name }: { firstName: string; surname: string; photoUrl?: string | null; name: string }) {
  return (
    <div className="u8t-panel-who">
      <TeamAvatar firstName={firstName} surname={surname} photoUrl={photoUrl} large />
      <p className="u8t-panel-name">{name}</p>
    </div>
  );
}

/** "Open full page ›" under a name: the team member's own page. */
export function OpenFullPageLink({ to, name }: { to: string; name: string }) {
  const t = useT();
  return (
    <Link className="u8t-full-link" to={to} aria-label={t('instructors.team.openFullPageAria', { name })} onClick={(e) => e.stopPropagation()}>
      {t('instructors.team.openFullPage')}
      <span aria-hidden="true"> ›</span>
    </Link>
  );
}

/** On a phone and a tablet the panel sits below the list, so picking a
 * person brings it into view. */
export function showPanel() {
  if (typeof window === 'undefined' || !window.matchMedia?.('(max-width: 1023px)').matches) return;
  window.requestAnimationFrame(() => document.querySelector('.u8t-under-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

/**
 * The Team list pages' panel. On a computer it is the page's right-hand
 * panel (`inspector`); on a phone and a tablet the same panel sits straight
 * under the list (`underList`), not at the foot of the page (DESIGN.md →
 * "Team member full page": "the Team page's side panel … sits under the
 * staff list"). Only one of the two shows at a time.
 */
export function teamPanel(content: React.ReactNode, label: string) {
  // With nobody to show (an empty list), the panel is still there but hidden,
  // so the page around the list keeps its shape and its filters.
  if (!content) return { inspector: <span className="u8t-panel-empty" hidden />, underList: null };
  return {
    inspector: (
      <>
        <span className="u8t-panel-mark" hidden />
        {content}
      </>
    ),
    underList: (
      <aside className="u8t-under-list" aria-label={label}>
        <p className="u8n-inspector__label" aria-hidden="true">
          {label}
        </p>
        {content}
      </aside>
    ),
  };
}

/** Row props for a list row you click to show the person in the panel. */
export function pickRow(selected: boolean, pick: () => void) {
  return {
    'data-pick': 'true',
    'data-sel': selected ? 'true' : 'false',
    onClick: (e: React.MouseEvent) => {
      // Buttons, links and menus inside the row do their own thing.
      if ((e.target as HTMLElement).closest('button, a, [role="menu"], input, label')) return;
      pick();
      showPanel();
    },
  } as const;
}

/** An on/off switch (DESIGN.md → "One accent: mint": pale-green track when
 * on), named by `label`. */
function TeamSwitch({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" role="switch" className="u8t-switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onChange(!checked)}>
      <span aria-hidden="true" />
    </button>
  );
}

type ChargePending = { canCreateCharges: boolean; canCancelCharges: boolean };

/**
 * "Front desk and money" for one person (DESIGN.md → "Team member full
 * page"): Can create charges and Can cancel charges (Decisions 303, 338) and
 * Can start open mat sessions (Decision 386), the same switches and saves as
 * the Staff page's former per-person tables. Only Branch Staff and coaches
 * have them (the owner always can), so it shows nothing for anyone else.
 * Only the main owner changes them (Decision 448 item 6); a co-owner sees
 * them locked.
 */
export function FrontDeskSwitches({ schoolId, userId, name, variant = 'panel' }: { schoolId: string; userId: string; name: string; variant?: 'panel' | 'card' }) {
  const t = useT();
  const isMainOwner = useIsMainOwner(schoolId);
  const locked = isMainOwner !== true;
  const charges = useChargePermissions(schoolId);
  const saveCharge = useSetChargePermission(schoolId);
  const openMat = useOpenMatPermissions(schoolId);
  const saveOpenMat = useSetOpenMatPermission(schoolId);
  const [error, setError] = useState<string | null>(null);
  // Shows the new state at once; it goes back if saving fails.
  const [chargeSaving, setChargeSaving] = useState<ChargePending | null>(null);
  const [openMatSaving, setOpenMatSaving] = useState<boolean | null>(null);

  const charge = charges.data?.items.find((p) => p.userId === userId);
  const mat = openMat.data?.items.find((p) => p.userId === userId);
  const loadError = charges.error || openMat.error;
  if (!charge && !mat && !loadError) return null;

  const chargeNow: ChargePending | null = chargeSaving ?? (charge ? { canCreateCharges: charge.canCreateCharges, canCancelCharges: charge.canCancelCharges } : null);

  async function toggleCharge(next: ChargePending) {
    setError(null);
    setChargeSaving(next);
    try {
      await saveCharge.mutateAsync({ userId, ...next });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('charges.permissions.saveFailed'));
    } finally {
      setChargeSaving(null);
    }
  }

  async function toggleOpenMat(canStartOpenMat: boolean) {
    setError(null);
    setOpenMatSaving(canStartOpenMat);
    try {
      await saveOpenMat.mutateAsync({ userId, canStartOpenMat });
    } catch (err) {
      setError(openMatErrorText(err, t('frontDesk.openMatPermissions.saveFailed')));
    } finally {
      setOpenMatSaving(null);
    }
  }

  const rows = (
    <>
      {isMainOwner === false ? <p className="u8t-hint">{t('roleGrants.staff.switchesMainOwnerOnly')}</p> : null}
      {error ? <ErrorBanner message={error} /> : null}
      {charges.error ? <ErrorBanner message={charges.error instanceof ApiError ? charges.error.message : t('charges.permissions.loadFailed')} /> : null}
      {openMat.error ? <ErrorBanner message={openMatErrorText(openMat.error, t('frontDesk.openMatPermissions.loadFailed'))} /> : null}
      {chargeNow ? (
        <>
          <div className="u8t-switch-row">
            <span>{t('charges.permissions.columnCreate')}</span>
            <TeamSwitch
              label={t('charges.permissions.createLabel', { name })}
              checked={chargeNow.canCreateCharges}
              disabled={locked || chargeSaving !== null}
              onChange={(on) => void toggleCharge({ ...chargeNow, canCreateCharges: on })}
            />
          </div>
          <div className="u8t-switch-row">
            <span>{t('charges.permissions.columnCancel')}</span>
            <TeamSwitch
              label={t('charges.permissions.cancelLabel', { name })}
              checked={chargeNow.canCancelCharges}
              disabled={locked || chargeSaving !== null}
              onChange={(on) => void toggleCharge({ ...chargeNow, canCancelCharges: on })}
            />
          </div>
        </>
      ) : null}
      {mat ? (
        <div className="u8t-switch-row">
          <span>{t('frontDesk.openMatPermissions.columnAllowed')}</span>
          <TeamSwitch
            label={t('frontDesk.openMatPermissions.checkboxLabel', { name })}
            checked={openMatSaving ?? mat.canStartOpenMat}
            disabled={locked || openMatSaving !== null}
            onChange={(on) => void toggleOpenMat(on)}
          />
        </div>
      ) : null}
      <p className="u8t-hint">{t('instructors.team.refundsNote')}</p>
    </>
  );

  if (variant === 'card') {
    return (
      <TeamCard title={t('instructors.team.frontDesk')}>
        <div className="u8t-rows">{rows}</div>
      </TeamCard>
    );
  }
  return (
    <>
      <p className="u8t-sec">{t('instructors.team.frontDesk')}</p>
      {rows}
    </>
  );
}

/** The belt picture for an instructor's chosen belt, from the style's ranks
 * (the same picture as everywhere else, grading/BeltChip.tsx). */
export function BeltPicture({ disciplineId, stripeTierId }: { disciplineId: string; stripeTierId: string }) {
  const ranks = useRanks(disciplineId);
  const rung = flattenLadder(ranks.data?.items ?? []).find((r) => r.id === stripeTierId);
  return rung ? <BeltChip rung={rung} /> : null;
}

/** One instructor's belts, for the Staff page's panel (Decisions 108, 188):
 * the belt in each style and whether it's verified. Nothing for someone who
 * isn't an instructor here. */
export function PersonBelts({ schoolId, userId }: { schoolId: string; userId: string }) {
  const t = useT();
  const data = useSchoolInstructorBelts(schoolId);
  const belts = (data.data?.items ?? []).filter((b) => b.userId === userId);
  const waiting = (data.data?.instructors ?? []).some((i) => i.userId === userId);
  if (belts.length === 0 && !waiting) return null;
  return (
    <>
      <p className="u8t-sec">{t('instructors.team.belts')}</p>
      {belts.length === 0 ? <p className="u8t-hint">{t('instructors.belts.emptyTitle')}</p> : null}
      {belts.map((b) => (
        <div key={b.id} className="u8t-belt-line">
          <div className="u8t-belt-line__top">
            <span>{b.disciplineName}</span>
            <BeltStatus verified={b.verificationStatus === 'VERIFIED'} />
          </div>
          <span className="u8t-belt">
            <BeltPicture disciplineId={b.disciplineId} stripeTierId={b.stripeTierId} />
            <span>{b.beltName}</span>
          </span>
        </div>
      ))}
    </>
  );
}

export function BeltStatus({ verified }: { verified: boolean }) {
  const t = useT();
  return verified ? <span className="u8t-tag u8t-tag--ok">{t('instructors.belts.verified')}</span> : <span className="u8t-tag u8t-tag--bad">{t('instructors.belts.notVerified')}</span>;
}

/** The search box of a Team list: a round field with a magnifier. */
export function TeamSearch({ id, label, placeholder, value, onChange }: { id: string; label: string; placeholder: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="u8t-search">
      <label className="u8t-search__label" htmlFor={id}>
        {label}
      </label>
      <span className="u8t-search__box">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input id={id} type="search" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
      </span>
    </div>
  );
}

/** The Team pages' white header (DESIGN.md → Team board): "Team" and the
 * School's name. Instructors and Staff are the tabs in the bar above it,
 * which the app shell already shows, so they aren't repeated here. */
export function TeamHeader({ schoolId, actions }: { schoolId: string | null; actions?: React.ReactNode }) {
  const t = useT();
  const school = useSchool(schoolId);
  return <NewLookPageHeader title={t('layout.newLook.groups.team')} subtitle={school.data?.name} actions={actions} />;
}
