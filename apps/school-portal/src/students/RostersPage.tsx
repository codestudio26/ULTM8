import React, { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Button, EmptyState, ErrorBanner, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth, useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { useMyStaffAccess } from '../roleGrants/roleGrantQueries';
import { useT } from '../i18n/I18nProvider';
import { useStudents, type StudentSummary } from './studentQueries';
import { BillingCard, BillingPage } from '../billing/BillingLook';
import { NewLookPageHeader } from '../layout/NewLookPage';
import { NewLookSelect } from '../layout/NewLookSelect';
import { FitTable } from './StudentsSectionLook';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import {
  ROSTER_NAME_MAX,
  useAddRosterStudents,
  useCreateRoster,
  useDeleteRoster,
  useRemoveRosterStudent,
  useRenameRoster,
  useRosterStudents,
  useRosters,
  type Roster,
} from './rosterQueries';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const clean = (s: string) => s.trim().replace(/\s+/g, ' ');
const fullName = (s: StudentSummary) => `${s.firstName} ${s.surname}`.trim();

/**
 * Rosters (Decision 317 item 6): named lists of students for staff, to take
 * attendance (the roll call's roster filter) or filter the Students list.
 * Being on a roster doesn't change who can book. Members never see rosters.
 * The same people as the Students page manage them: the owner, and Branch
 * Staff with the Students switch, for the students they cover.
 *
 * New look (Decision 453): the approved design draws no Rosters screen, so the
 * page keeps its lists, forms and actions and takes the new header (with
 * "‹ Students" in place of the old back link), white cards, soft fields, the
 * new drop-down and pill buttons; the students table becomes cards when it
 * doesn't fit. Delete asks in the standard delete pop-up (Decision 462 item 3).
 */
export function RostersPage() {
  const t = useT();
  const { claims } = useAuth();
  const ownedSchoolId = useOwnedSchoolId();
  const coachSchoolId = useCoachSchoolId();
  const isBranchStaff = !ownedSchoolId && !!claims?.grants.some((g) => g.role === 'BRANCH_STAFF' && g.schoolId === coachSchoolId);
  const myAccess = useMyStaffAccess(isBranchStaff ? coachSchoolId : null);
  const schoolId = ownedSchoolId ?? (myAccess.data?.access.students ? coachSchoolId : null);
  const rosters = useRosters(schoolId);
  const create = useCreateRoster(schoolId ?? '');
  const remove = useDeleteRoster(schoolId ?? '');
  const [name, setName] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Roster | null>(null);

  if (isBranchStaff && myAccess.isLoading) return <Spinner />;
  if (!schoolId) return <Navigate to="/" replace />;
  const items = rosters.data?.items ?? [];
  const open = items.find((r) => r.id === openId) ?? null;

  return (
    <BillingPage>
      <NewLookPageHeader parent={{ to: '/students', label: t('layout.nav.students') }} title={t('students.rosters.title')} subtitle={t('students.rosters.subtitle')} />
      <BillingCard>
        {rosters.isLoading ? <Spinner /> : null}
        {rosters.error ? <ErrorBanner message={errorText(rosters.error, t('students.rosters.loadFailed'))} /> : null}
        {create.error ? <ErrorBanner message={errorText(create.error, t('students.rosters.failed'))} /> : null}
        {!rosters.isLoading && items.length === 0 ? <EmptyState title={t('students.rosters.emptyTitle')} description={t('students.rosters.emptyDescription')} /> : null}
        {items.length ? (
          <ul className="u8st-rosters">
            {items.map((roster) => (
              <RosterRow
                key={`${roster.id}-${roster.name}`}
                schoolId={schoolId}
                roster={roster}
                isOpen={roster.id === openId}
                onOpen={() => setOpenId(roster.id === openId ? null : roster.id)}
                onDelete={() => setDeleting(roster)}
              />
            ))}
          </ul>
        ) : null}
        <form
          className="u8st-inline-form u8st-roster-new"
          onSubmit={(e) => {
            e.preventDefault();
            if (clean(name)) create.mutate(clean(name), { onSuccess: (r) => { setName(''); setOpenId(r.id); } });
          }}
        >
          <div className="u8st-inline-form__field">
            <TextField aria-label={t('students.rosters.newLabel')} placeholder={t('students.rosters.newPlaceholder')} maxLength={ROSTER_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary" disabled={!clean(name)} loading={create.isPending}>
            {t('students.rosters.add')}
          </Button>
        </form>
      </BillingCard>
      {open ? <RosterMembersCard schoolId={schoolId} roster={open} /> : null}
      {deleting ? (
        <ConfirmDeleteModal
          title={t('students.rosters.deleteTitle', { name: deleting.name })}
          description={t('students.rosters.confirmDelete')}
          genericErrorMessage={t('students.rosters.failed')}
          onConfirm={() => remove.mutateAsync(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      ) : null}
    </BillingPage>
  );
}

function RosterRow({ schoolId, roster, isOpen, onOpen, onDelete }: { schoolId: string; roster: Roster; isOpen: boolean; onOpen: () => void; onDelete: () => void }) {
  const t = useT();
  const rename = useRenameRoster(schoolId);
  const [name, setName] = useState(roster.name);
  // A failed delete shows in the delete pop-up, which stays open.
  const error = rename.error;
  const changed = clean(name) !== '' && clean(name) !== roster.name;

  return (
    <li className={'u8st-roster' + (isOpen ? ' u8st-roster--open' : '')}>
      {error ? <ErrorBanner message={errorText(error, t('students.rosters.failed'))} /> : null}
      <form
        className="u8st-inline-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) rename.mutate({ rosterId: roster.id, name: clean(name) });
        }}
      >
        <div className="u8st-inline-form__field">
          <TextField aria-label={t('students.rosters.nameLabel', { roster: roster.name })} maxLength={ROSTER_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <span className="u8b-note u8st-roster__count">{t('students.rosters.count', { count: roster.memberCount })}</span>
        <div className="u8st-roster__actions">
        <Button type="button" variant={isOpen ? 'primary' : 'secondary'} onClick={onOpen}>
          {isOpen ? t('students.rosters.close') : t('students.rosters.open')}
        </Button>
        <Button type="submit" variant="secondary" disabled={!changed} loading={rename.isPending}>
          {t('students.rosters.rename')}
        </Button>
        <Button type="button" variant="secondary" onClick={onDelete}>
          {t('students.rosters.delete')}
        </Button>
        </div>
      </form>
    </li>
  );
}

/** The roster's students, with Remove, and a picker to add a current student. */
function RosterMembersCard({ schoolId, roster }: { schoolId: string; roster: Roster }) {
  const t = useT();
  const students = useStudents(schoolId, 'ACTIVE');
  const members = useRosterStudents(schoolId, roster.id);
  const add = useAddRosterStudents(schoolId, roster.id);
  const remove = useRemoveRosterStudent(schoolId, roster.id);
  const [picked, setPicked] = useState('');
  const memberIds = useMemo(() => new Set(members.data?.studentIds ?? []), [members.data]);
  const all = students.data?.items ?? [];
  const onRoster = all.filter((s) => memberIds.has(s.id)).sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const others = all.filter((s) => !memberIds.has(s.id)).sort((a, b) => fullName(a).localeCompare(fullName(b)));
  const error = add.error ?? remove.error ?? members.error ?? students.error;

  return (
    <BillingCard title={roster.name}>
      {error ? <ErrorBanner message={errorText(error, t('students.rosters.failed'))} /> : null}
      <form
        className="u8st-inline-form u8st-roster-add"
        onSubmit={(e) => {
          e.preventDefault();
          if (picked) add.mutate([picked], { onSuccess: () => setPicked('') });
        }}
      >
        <div className="u8n-dd-field">
          <NewLookSelect
            id="roster-add-student"
            label={t('students.rosters.addStudentLabel')}
            value={picked}
            onChange={setPicked}
            options={[{ value: '', label: t('students.rosters.pickStudent') }, ...others.map((s) => ({ value: s.id, label: fullName(s) }))]}
          />
        </div>
        <Button type="submit" variant="secondary" disabled={!picked} loading={add.isPending}>
          {t('students.rosters.addStudent')}
        </Button>
      </form>
      {members.isLoading || students.isLoading ? (
        <Spinner />
      ) : onRoster.length === 0 ? (
        <p className="u8b-note">{t('students.rosters.noMembers')}</p>
      ) : (
        <FitTable<StudentSummary>
          rows={onRoster}
          columns={[
            { key: 'name', header: t('students.columnName'), main: true, render: (s) => <Link to={`/students/${s.id}`} className="u8b-name">{fullName(s)}</Link> },
            {
              key: 'remove',
              header: '',
              render: (s) => (
                <Button variant="secondary" className="u8b-pill--row" loading={remove.isPending && remove.variables === s.id} onClick={() => remove.mutate(s.id)} aria-label={t('students.rosters.removeStudent', { name: fullName(s) })}>
                  {t('students.rosters.remove')}
                </Button>
              ),
            },
          ]}
        />
      )}
    </BillingCard>
  );
}
