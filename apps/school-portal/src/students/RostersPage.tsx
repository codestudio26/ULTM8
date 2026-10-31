import React, { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { Button, Card, EmptyState, ErrorBanner, Field, PageHeader, SelectField, Spinner, Table, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth, useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { useMyStaffAccess } from '../roleGrants/roleGrantQueries';
import { useT } from '../i18n/I18nProvider';
import { useStudents, type StudentSummary } from './studentQueries';
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
  const [name, setName] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  if (isBranchStaff && myAccess.isLoading) return <Spinner />;
  if (!schoolId) return <Navigate to="/" replace />;
  const items = rosters.data?.items ?? [];
  const open = items.find((r) => r.id === openId) ?? null;

  return (
    <>
      <PageHeader title={t('students.rosters.title')} subtitle={t('students.rosters.subtitle')} />
      <p>
        <Link to="/students">{t('students.rosters.back')}</Link>
      </p>
      <Card>
        {rosters.isLoading ? <Spinner /> : null}
        {rosters.error ? <ErrorBanner message={errorText(rosters.error, t('students.rosters.loadFailed'))} /> : null}
        {create.error ? <ErrorBanner message={errorText(create.error, t('students.rosters.failed'))} /> : null}
        {!rosters.isLoading && items.length === 0 ? <EmptyState title={t('students.rosters.emptyTitle')} description={t('students.rosters.emptyDescription')} /> : null}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((roster) => (
            <RosterRow key={`${roster.id}-${roster.name}`} schoolId={schoolId} roster={roster} isOpen={roster.id === openId} onOpen={() => setOpenId(roster.id === openId ? null : roster.id)} />
          ))}
        </ul>
        <form
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}
          onSubmit={(e) => {
            e.preventDefault();
            if (clean(name)) create.mutate(clean(name), { onSuccess: (r) => { setName(''); setOpenId(r.id); } });
          }}
        >
          <div style={{ flex: '1 1 220px', minWidth: 0 }}>
            <TextField aria-label={t('students.rosters.newLabel')} placeholder={t('students.rosters.newPlaceholder')} maxLength={ROSTER_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary" disabled={!clean(name)} loading={create.isPending}>
            {t('students.rosters.add')}
          </Button>
        </form>
      </Card>
      {open ? <RosterMembersCard schoolId={schoolId} roster={open} /> : null}
    </>
  );
}

function RosterRow({ schoolId, roster, isOpen, onOpen }: { schoolId: string; roster: Roster; isOpen: boolean; onOpen: () => void }) {
  const t = useT();
  const rename = useRenameRoster(schoolId);
  const remove = useDeleteRoster(schoolId);
  const [name, setName] = useState(roster.name);
  const [confirming, setConfirming] = useState(false);
  const error = rename.error ?? remove.error;
  const changed = clean(name) !== '' && clean(name) !== roster.name;

  return (
    <li>
      {error ? <ErrorBanner message={errorText(error, t('students.rosters.failed'))} /> : null}
      <form
        style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (changed) rename.mutate({ rosterId: roster.id, name: clean(name) });
        }}
      >
        <div style={{ flex: '1 1 220px', minWidth: 0 }}>
          <TextField aria-label={t('students.rosters.nameLabel', { roster: roster.name })} maxLength={ROSTER_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <span className="ultm8-field__hint">{t('students.rosters.count', { count: roster.memberCount })}</span>
        <Button type="button" variant={isOpen ? 'primary' : 'secondary'} onClick={onOpen}>
          {isOpen ? t('students.rosters.close') : t('students.rosters.open')}
        </Button>
        <Button type="submit" variant="secondary" disabled={!changed} loading={rename.isPending}>
          {t('students.rosters.rename')}
        </Button>
        {confirming ? (
          <>
            <span>{t('students.rosters.confirmDelete')}</span>
            <Button type="button" variant="danger" loading={remove.isPending} onClick={() => remove.mutate(roster.id)}>
              {t('students.rosters.delete')}
            </Button>
            <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
              {t('common.cancel')}
            </Button>
          </>
        ) : (
          <Button type="button" variant="secondary" onClick={() => setConfirming(true)}>
            {t('students.rosters.delete')}
          </Button>
        )}
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
    <Card>
      <h2 style={{ fontSize: 18, margin: '0 0 12px' }}>{roster.name}</h2>
      {error ? <ErrorBanner message={errorText(error, t('students.rosters.failed'))} /> : null}
      <form
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (picked) add.mutate([picked], { onSuccess: () => setPicked('') });
        }}
      >
        <div style={{ flex: '1 1 260px', minWidth: 0 }}>
          <Field label={t('students.rosters.addStudentLabel')} htmlFor="roster-add-student">
            <SelectField
              id="roster-add-student"
              value={picked}
              onChange={(e) => setPicked(e.target.value)}
              options={[{ value: '', label: t('students.rosters.pickStudent') }, ...others.map((s) => ({ value: s.id, label: fullName(s) }))]}
            />
          </Field>
        </div>
        <Button type="submit" variant="secondary" disabled={!picked} loading={add.isPending}>
          {t('students.rosters.addStudent')}
        </Button>
      </form>
      {members.isLoading || students.isLoading ? (
        <Spinner />
      ) : onRoster.length === 0 ? (
        <p className="ultm8-field__hint">{t('students.rosters.noMembers')}</p>
      ) : (
        <Table<StudentSummary>
          rows={onRoster}
          columns={[
            { key: 'name', header: t('students.columnName'), render: (s) => <Link to={`/students/${s.id}`}>{fullName(s)}</Link> },
            {
              key: 'remove',
              header: '',
              render: (s) => (
                <Button variant="secondary" loading={remove.isPending && remove.variables === s.id} onClick={() => remove.mutate(s.id)} aria-label={t('students.rosters.removeStudent', { name: fullName(s) })}>
                  {t('students.rosters.remove')}
                </Button>
              ),
            },
          ]}
        />
      )}
    </Card>
  );
}
