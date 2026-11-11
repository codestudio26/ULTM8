import React, { useDeferredValue, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, EmptyState, ErrorBanner, Field, Modal, PhoneField, RowActionsMenu, Spinner, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth } from '../auth/AuthContext';
import type { BranchResponse } from '../branches/branchQueries';
import { ROLE_LABELS } from '../lib/enumLabels';
import { formatLocale } from '../i18n/format';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { useT } from '../i18n/I18nProvider';
import { RemoveFromSchoolModal } from './RemoveFromSchoolModal';
import { NewLookSelect } from '../layout/NewLookSelect';
import { OpenFullPageLink, TeamAvatar, TeamCard, TeamSearch, pickRow, showPanel } from '../team/TeamParts';
import { StaffAccessModal, presetOf } from './StaffAccessModal';
import { useHandOverMainOwner, usePauseStaff, useStaffList, useUnpauseStaff, useUpdateStaffDetails, type StaffListFilters, type StaffMember, type StaffRoleEntry } from './roleGrantQueries';

/** Rows are keyed by `id`. */
type StaffRow = StaffMember & { id: string };

/**
 * The Staff page's list (Decision 361): everyone who holds, or held, an owner,
 * coach or Branch Staff role at this School, one row per person. Replaces
 * looking people up by User ID. Removed staff stay findable under the
 * "Removed" status, hidden by default.
 *
 * Each person's menu removes one role (the existing Revoke, confirmed by the
 * page's own dialog) or, with "Remove from School", every coach and Branch
 * Staff role they hold here at once (RemoveFromSchoolModal, which asks what
 * happens to the classes they teach).
 *
 * Decision 370 — owners show as "Main owner" or "Co-owner". Nobody here can
 * remove the main owner, only ULTM8 support. The main owner can make a
 * co-owner the main owner, after re-entering their passcode.
 *
 * Decision 423 item 10 — only the main owner removes, pauses or unpauses
 * anyone (`canManageRoles`); co-owners keep "Edit details". Decision 448 item
 * 6: "Access" (the switches) is the main owner's too.
 *
 * Decision 381 — "Edit details" sets the School's own display name and work
 * phone for someone. The list shows them first, with the person's own account
 * name and phone underneath; the account itself never changes.
 *
 * Decision 387 — "Access" sets a Branch Staff member's switches
 * (StaffAccessModal); their row shows the preset they match. Branch Staff
 * whose owner lets them see the staff list get this list read only
 * (`readOnly`): their branches' current staff, no menu, no Removed filter.
 *
 * Decision 390 — "Pause" stops all of a coach's or Branch Staff member's
 * access here at once and keeps everything set for them; "Unpause" gives the
 * same roles back. Paused people stay in the list (with the active ones, and
 * under their own "Paused" status) and can still be removed from the School.
 */
export function StaffListSection({
  schoolId,
  branches,
  onRevokeRole,
  readOnly = false,
  canManageRoles = false,
  intro,
  selectedUserId = null,
  onSelect,
  fullPageOf,
}: {
  schoolId: string;
  branches: BranchResponse[];
  onRevokeRole: (person: StaffMember, role: StaffRoleEntry) => void;
  readOnly?: boolean;
  /** The School's main owner (Decision 423 item 10): may remove and pause. */
  canManageRoles?: boolean;
  /** The grey line under the card's heading. */
  intro?: string;
  /** The person in the page's right-hand panel. */
  selectedUserId?: string | null;
  /** Called with the person the panel shows: the one picked, the first row
   * until one is, and again whenever the list reloads (fresh details). */
  onSelect?: (person: StaffMember | null) => void;
  /** Their Instructor profile page, for "Open full page ›" (null: none). */
  fullPageOf?: (userId: string) => string | null;
}) {
  const t = useT();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState<StaffListFilters['status']>('active');
  const q = useDeferredValue(search.trim());
  const filters: StaffListFilters = {
    status,
    role: (role || undefined) as StaffListFilters['role'],
    branchId: branchId || undefined,
    q: q || undefined,
  };
  const { data, isLoading, error } = useStaffList(schoolId, filters);
  const [confirmingRemove, setConfirmingRemove] = useState<StaffMember | null>(null);
  const { claims } = useAuth();
  const [handingOver, setHandingOver] = useState<StaffMember | null>(null);
  const [handedOverTo, setHandedOverTo] = useState<string | null>(null);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [savedFor, setSavedFor] = useState<string | null>(null);
  const [settingAccess, setSettingAccess] = useState<StaffMember | null>(null);
  const [accessSavedFor, setAccessSavedFor] = useState<string | null>(null);
  const [pausing, setPausing] = useState<StaffMember | null>(null);
  const [pauseNotice, setPauseNotice] = useState<string | null>(null);
  const [unpauseError, setUnpauseError] = useState<string | null>(null);
  const unpauseStaff = useUnpauseStaff(schoolId);

  const filtering = !!(q || role || branchId || status !== 'active');
  const people: StaffRow[] = (data?.items ?? []).map((p) => ({ ...p, id: p.userId }));
  const roleLabel = (r: string) => (ROLE_LABELS[r] ? t(ROLE_LABELS[r]!) : r);
  const fullName = (p: StaffMember) => `${p.firstName} ${p.surname}`.trim();
  const shownName = (p: StaffMember) => p.displayName ?? fullName(p);
  const ownerLabel = (p: StaffMember) => (p.mainOwner ? t('roleGrants.list.mainOwner') : t('roleGrants.list.coOwner'));
  const roleText = (r: StaffRoleEntry, p?: StaffMember) =>
    r.role === 'SCHOOL_OWNER_MANAGER' && p && !r.revokedAt
      ? ownerLabel(p)
      : r.branchName
        ? `${roleLabel(r.role)} · ${r.branchName}`
        : roleLabel(r.role);
  const date = (iso: string) => new Date(iso).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  // The main owner's owner role is never removed from this list (Decision 370).
  const removable = (p: StaffMember) => p.roles.filter((r) => !r.revokedAt && !(r.role === 'SCHOOL_OWNER_MANAGER' && p.mainOwner));
  // "Remove from School" ends coach and Branch Staff roles only, paused ones too.
  const coachRoles = (p: StaffMember) => p.roles.filter((r) => (!r.revokedAt || r.pausedAt) && r.role !== 'SCHOOL_OWNER_MANAGER');
  // Owners are never paused (Decision 390).
  const pausable = (p: StaffMember) => p.active && !p.roles.some((r) => !r.revokedAt && r.role === 'SCHOOL_OWNER_MANAGER') && coachRoles(p).length > 0;
  async function unpause(p: StaffMember) {
    setPauseNotice(null);
    setUnpauseError(null);
    try {
      const { closedBranches: closed } = await unpauseStaff.mutateAsync(p.userId);
      setPauseNotice(
        closed.length > 0
          ? t('roleGrants.list.unpausedClosed', { name: shownName(p), branches: closed.join(', ') })
          : t('roleGrants.list.unpausedDone', { name: shownName(p) }),
      );
    } catch (err) {
      setUnpauseError(err instanceof ApiError ? err.message : t('roleGrants.list.unpauseFailed'));
    }
  }
  const iAmMainOwner = (data?.items ?? []).some((p) => p.userId === claims?.sub && p.mainOwner);
  // Keep the panel's person in step with the list.
  useEffect(() => {
    if (!onSelect || !data) return;
    const items = data.items;
    onSelect(items.find((p) => p.userId === selectedUserId) ?? items[0] ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onSelect is the page's setter; the list's data and the pick are what matter.
  }, [data, selectedUserId]);
  const shownSelected = people.find((p) => p.userId === selectedUserId) ?? people[0] ?? null;
  const pick = (p: StaffMember) => onSelect?.(p);
  const roleTags = (p: StaffMember) => {
    const shown = p.active ? p.roles.filter((r) => !r.revokedAt) : p.paused ? p.roles.filter((r) => r.pausedAt) : p.roles;
    return (
      <div className="u8t-tags">
        {shown.map((r) => (
          <span key={r.grantId} className={'u8t-tag' + (r.revokedAt ? '' : ' u8t-tag--info')}>
            {roleText(r, p)}
          </span>
        ))}
        {p.access ? <span className="u8t-tag">{(() => { const preset = presetOf(p.access); return preset ? t(preset) : t('roleGrants.access.custom'); })()}</span> : null}
      </div>
    );
  };
  const rowActions = (p: StaffMember) => {
    if (readOnly) return null;
    const actions = [
      ...(p.active || p.paused ? [{ label: t('roleGrants.list.editDetails'), onClick: () => setEditing(p) }] : []),
      // Decision 448 item 6: only the main owner sets the switches.
      // Decision 449 item 7: a coach's Access window ("Manage students").
      ...((p.access || p.coachAccess) && canManageRoles ? [{ label: t('roleGrants.access.action'), onClick: () => setSettingAccess(p) }] : []),
      ...(iAmMainOwner && isCoOwner(p) && p.userId !== claims?.sub
        ? [{ label: t('roleGrants.list.makeMainOwner'), onClick: () => setHandingOver(p) }]
        : []),
      ...(canManageRoles
        ? [
            ...removable(p).map((r) =>
              r.role === 'SCHOOL_OWNER_MANAGER'
                ? { label: t('roleGrants.list.removeCoOwner'), onClick: () => onRevokeRole(p, r) }
                : { label: t('roleGrants.list.removeRole', { role: roleText(r) }), onClick: () => onRevokeRole(p, r) },
            ),
            ...(pausable(p) ? [{ label: t('roleGrants.list.pause'), onClick: () => setPausing(p) }] : []),
            ...(p.paused ? [{ label: t('roleGrants.list.unpause'), onClick: () => void unpause(p) }] : []),
            ...(coachRoles(p).length > 0 ? [{ label: t('roleGrants.list.removeFromSchool'), onClick: () => setConfirmingRemove(p) }] : []),
          ]
        : []),
    ];
    if (actions.length === 0) return null;
    return <RowActionsMenu label={t('roleGrants.list.actionsAria', { name: shownName(p) })} actions={actions} />;
  };
  const isCoOwner = (p: StaffMember) => !p.mainOwner && p.roles.some((r) => !r.revokedAt && r.role === 'SCHOOL_OWNER_MANAGER');

  return (
    <TeamCard
      title={t('roleGrants.list.heading')}
      intro={intro}
      action={
        readOnly ? undefined : (
          <Link className="u8t-cardbar__link" to="/grading/permissions">
            {t('grading.settings.who.link')}
          </Link>
        )
      }
    >
      <div className="u8t-toolbar">
        <TeamSearch id="staff-search" label={t('roleGrants.list.search')} placeholder={t('roleGrants.list.searchPlaceholder')} value={search} onChange={setSearch} />
        <NewLookSelect
          id="staff-role-filter"
          label={t('roleGrants.list.role')}
          value={role}
          onChange={setRole}
          options={[
            { value: '', label: t('roleGrants.list.any') },
            { value: 'SCHOOL_OWNER_MANAGER', label: roleLabel('SCHOOL_OWNER_MANAGER') },
            { value: 'INSTRUCTOR', label: roleLabel('INSTRUCTOR') },
            { value: 'BRANCH_STAFF', label: roleLabel('BRANCH_STAFF') },
          ]}
        />
        {branches.length > 0 ? (
          <NewLookSelect
            id="staff-branch-filter"
            label={t('roleGrants.list.branch')}
            value={branchId}
            onChange={setBranchId}
            options={[{ value: '', label: t('roleGrants.list.any') }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
          />
        ) : null}
        {readOnly ? null : (
          <NewLookSelect
            id="staff-status-filter"
            label={t('roleGrants.list.status')}
            value={status}
            onChange={(v) => setStatus(v as StaffListFilters['status'])}
            options={[
              { value: 'active', label: t('roleGrants.list.statusActive') },
              { value: 'paused', label: t('roleGrants.list.statusPaused') },
              { value: 'removed', label: t('roleGrants.list.statusRemoved') },
              { value: 'all', label: t('roleGrants.list.statusAll') },
            ]}
          />
        )}
      </div>

      <div className="u8t-banners">
        {handedOverTo ? <SuccessBanner message={t('roleGrants.list.handOverDone', { name: handedOverTo })} /> : null}
        {savedFor ? <SuccessBanner message={t('roleGrants.list.detailsSaved', { name: savedFor })} /> : null}
        {accessSavedFor ? <SuccessBanner message={t('roleGrants.access.saved', { name: accessSavedFor })} /> : null}
        {pauseNotice ? <SuccessBanner message={pauseNotice} /> : null}
        {unpauseError ? <ErrorBanner message={unpauseError} /> : null}
        {error ? <ErrorBanner message={t('roleGrants.list.loadFailed')} /> : null}
      </div>
      {isLoading ? (
        <div className="u8t-state">
          <Spinner />
        </div>
      ) : people.length === 0 ? (
        <div className="u8t-state">
          {filtering ? (
            <EmptyState title={t('roleGrants.list.noMatchTitle')} description={t('roleGrants.list.noMatchDescription')} />
          ) : (
            <EmptyState title={t('roleGrants.list.emptyTitle')} description={t('roleGrants.list.emptyDescription')} />
          )}
        </div>
      ) : (
        <table className="u8t-table">
          <thead>
            <tr>
              <th scope="col">{t('roleGrants.list.columnPerson')}</th>
              <th scope="col">{t('roleGrants.list.columnPhone')}</th>
              <th scope="col">{t('roleGrants.list.columnRoles')}</th>
              <th scope="col">{t('roleGrants.list.columnAdded')}</th>
              <th scope="col">{t('roleGrants.list.columnStatus')}</th>
              {readOnly ? null : <th scope="col" />}
            </tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const full = fullPageOf?.(p.userId) ?? null;
              const row = onSelect ? pickRow(shownSelected?.userId === p.userId, () => pick(p)) : {};
              return (
                <tr key={p.id} {...row}>
                  <td className="u8t-c-main">
                    <div className="u8t-who">
                      <TeamAvatar firstName={p.firstName} surname={p.surname} photoUrl={p.profilePhotoUrl ?? null} />
                      <div className="u8t-who__text">
                        {onSelect ? (
                          <button type="button" className="u8t-name" aria-pressed={shownSelected?.userId === p.userId} onClick={() => { pick(p); showPanel(); }}>
                            {shownName(p)}
                          </button>
                        ) : (
                          <span className="u8t-name">{shownName(p)}</span>
                        )}
                        {p.displayName ? <div className="u8t-sub">{t('roleGrants.list.accountName', { name: fullName(p) })}</div> : null}
                        <div className="u8t-sub">{p.email}</div>
                        {full ? (
                          <div>
                            <OpenFullPageLink to={full} name={shownName(p)} />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="u8t-k">{t('roleGrants.list.columnPhone')}: </span>
                    {p.workPhone ? (
                      <>
                        <span className="u8t-belt">
                          {p.workPhone} <span className="u8t-tag">{t('roleGrants.list.workPhoneTag')}</span>
                        </span>
                        {p.phone ? <div className="u8t-sub">{p.phone}</div> : null}
                      </>
                    ) : (
                      p.phone ?? '—'
                    )}
                  </td>
                  <td>{roleTags(p)}</td>
                  <td>
                    <span className="u8t-k">{t('roleGrants.list.columnAdded')}: </span>
                    {date(p.addedAt)}
                  </td>
                  <td className="u8t-c-end">
                    {p.active ? (
                      <span className="u8t-tag u8t-tag--ok">{t('roleGrants.list.statusActive')}</span>
                    ) : p.paused ? (
                      <span className="u8t-tag u8t-tag--warn">{t('roleGrants.list.pausedOn', { date: date(p.pausedAt!) })}</span>
                    ) : (
                      <span className="u8t-tag">{t('roleGrants.list.removedOn', { date: date(p.removedAt!) })}</span>
                    )}
                  </td>
                  {readOnly ? null : (
                    <td className="u8t-c-act">
                      <div className="u8t-actions">{rowActions(p)}</div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {confirmingRemove ? (
        <RemoveFromSchoolModal
          schoolId={schoolId}
          userId={confirmingRemove.userId}
          name={`${confirmingRemove.firstName} ${confirmingRemove.surname}`.trim()}
          description={t('roleGrants.list.removeDescription', { roles: coachRoles(confirmingRemove).map((r) => roleText(r)).join(', ') })}
          onClose={() => setConfirmingRemove(null)}
        />
      ) : null}

      {pausing ? (
        <PauseStaffModal
          schoolId={schoolId}
          person={pausing}
          name={shownName(pausing)}
          roles={coachRoles(pausing).map((r) => roleText(r)).join(', ')}
          onDone={() => {
            setUnpauseError(null);
            setPauseNotice(t('roleGrants.list.pausedDone', { name: shownName(pausing) }));
            setPausing(null);
          }}
          onClose={() => setPausing(null)}
        />
      ) : null}

      {settingAccess ? (
        <StaffAccessModal
          schoolId={schoolId}
          person={settingAccess}
          name={shownName(settingAccess)}
          onDone={() => {
            setAccessSavedFor(shownName(settingAccess));
            setSettingAccess(null);
          }}
          onClose={() => setSettingAccess(null)}
        />
      ) : null}

      {editing ? (
        <StaffDetailsModal
          schoolId={schoolId}
          person={editing}
          onDone={(name) => {
            setSavedFor(name);
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {handingOver ? (
        <HandOverMainOwnerModal
          schoolId={schoolId}
          person={handingOver}
          onDone={() => {
            setHandedOverTo(fullName(handingOver));
            setHandingOver(null);
          }}
          onClose={() => setHandingOver(null)}
        />
      ) : null}
    </TeamCard>
  );
}

/** Decision 390 — confirms "Pause": their roles stop at once, everything set
 * for them is kept, and Unpause gives the same roles back. */
function PauseStaffModal({
  schoolId,
  person,
  name,
  roles,
  onDone,
  onClose,
}: {
  schoolId: string;
  person: StaffMember;
  name: string;
  roles: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const pause = usePauseStaff(schoolId);
  const [error, setError] = useState<string | null>(null);

  async function handlePause() {
    setError(null);
    try {
      await pause.mutateAsync(person.userId);
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('roleGrants.list.pauseFailed'));
    }
  }

  return (
    <Modal title={t('roleGrants.list.pauseTitle', { name })} onClose={onClose}>
      <p>{t('roleGrants.list.pauseBody', { roles })}</p>
      {error ? <ErrorBanner message={error} /> : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
        <Button type="button" loading={pause.isPending} onClick={() => void handlePause()}>
          {t('roleGrants.list.pause')}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
      </div>
    </Modal>
  );
}

/** Decision 370 — the main owner makes a co-owner the main owner, after
 * re-entering their passcode. They stay an owner, as a co-owner. */
function HandOverMainOwnerModal({
  schoolId,
  person,
  onDone,
  onClose,
}: {
  schoolId: string;
  person: StaffMember;
  onDone: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const handOver = useHandOverMainOwner(schoolId);
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await handOver.mutateAsync({ userId: person.userId, passcode });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={t('roleGrants.list.handOverTitle', { name: `${person.firstName} ${person.surname}`.trim() })} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <p>{t('roleGrants.list.handOverBody')}</p>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('roleGrants.list.passcodeLabel')} htmlFor="hand-over-passcode">
          <TextField
            id="hand-over-passcode"
            type="password"
            inputMode="numeric"
            pattern="\d{6}"
            maxLength={6}
            required
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            autoComplete="current-password"
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={handOver.isPending}>
            {t('roleGrants.list.makeMainOwner')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Decision 381 — the School's own display name and work phone for a staff
 * member. Empty fields clear them. */
function StaffDetailsModal({
  schoolId,
  person,
  onDone,
  onClose,
}: {
  schoolId: string;
  person: StaffMember;
  onDone: (name: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const update = useUpdateStaffDetails(schoolId);
  const [displayName, setDisplayName] = useState(person.displayName ?? '');
  const [workPhone, setWorkPhone] = useState(person.workPhone ?? '');
  const [error, setError] = useState<string | null>(null);
  const accountName = `${person.firstName} ${person.surname}`.trim();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const saved = await update.mutateAsync({ userId: person.userId, displayName: displayName.trim() || null, workPhone: workPhone || null });
      onDone(saved.displayName ?? accountName);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={t('roleGrants.list.detailsTitle', { name: accountName })} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <p>{t('roleGrants.list.detailsBody')}</p>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('roleGrants.list.displayNameLabel')} htmlFor="staff-display-name" hint={t('roleGrants.list.displayNameHint')}>
          <TextField id="staff-display-name" maxLength={80} placeholder={accountName} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </Field>
        <Field label={t('roleGrants.list.workPhoneLabel')} htmlFor="staff-work-phone" hint={t('roleGrants.list.workPhoneHint')}>
          <PhoneField id="staff-work-phone" value={workPhone} onChange={setWorkPhone} defaultCountry={guessDefaultCountry()} />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={update.isPending}>
            {t('common.save')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
