import React, { useState } from 'react';
import { Button, ErrorBanner, Modal, ModalActions, Switch } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { ROLE_LABELS } from '../lib/enumLabels';
import { useSetCoachAccess, useSetStaffAccess, type CoachAccess, type StaffAccess, type StaffMember } from './roleGrantQueries';

type AccessKey = keyof StaffAccess;

/** The switches, grouped by area as Decision 320 lays out the Access page. */
const GROUPS: Array<{ heading: TranslationKey; keys: AccessKey[] }> = [
  { heading: 'roleGrants.access.groupSchedule', keys: ['classes', 'cancelClasses'] },
  { heading: 'roleGrants.access.groupCheckIn', keys: ['bookings', 'checkInRules', 'attendanceStats'] },
  { heading: 'roleGrants.access.groupMembers', keys: ['students', 'exportStudents', 'freezeMemberships', 'memberFiles', 'importData', 'seeMedicalInfo'] },
  // Decision 435 item 22: payroll covers the whole School's staff.
  { heading: 'roleGrants.access.groupStaff', keys: ['staffList', 'payroll'] },
  { heading: 'roleGrants.access.groupDisciplines', keys: ['disciplines'] },
  // Decision 442 item 3: "Can connect Stripe", in no preset.
  { heading: 'roleGrants.access.groupPayments', keys: ['connectStripe'] },
];

const LABELS: Record<AccessKey, { label: TranslationKey; hint: TranslationKey }> = {
  classes: { label: 'roleGrants.access.classes', hint: 'roleGrants.access.classesHint' },
  cancelClasses: { label: 'roleGrants.access.cancelClasses', hint: 'roleGrants.access.cancelClassesHint' },
  bookings: { label: 'roleGrants.access.bookings', hint: 'roleGrants.access.bookingsHint' },
  students: { label: 'roleGrants.access.students', hint: 'roleGrants.access.studentsHint' },
  staffList: { label: 'roleGrants.access.staffList', hint: 'roleGrants.access.staffListHint' },
  disciplines: { label: 'roleGrants.access.disciplines', hint: 'roleGrants.access.disciplinesHint' },
  checkInRules: { label: 'roleGrants.access.checkInRules', hint: 'roleGrants.access.checkInRulesHint' },
  exportStudents: { label: 'roleGrants.access.exportStudents', hint: 'roleGrants.access.exportStudentsHint' },
  freezeMemberships: { label: 'roleGrants.access.freezeMemberships', hint: 'roleGrants.access.freezeMembershipsHint' },
  attendanceStats: { label: 'roleGrants.access.attendanceStats', hint: 'roleGrants.access.attendanceStatsHint' },
  memberFiles: { label: 'roleGrants.access.memberFiles', hint: 'roleGrants.access.memberFilesHint' },
  importData: { label: 'imports.access.label', hint: 'imports.access.hint' },
  seeMedicalInfo: { label: 'roleGrants.access.seeMedicalInfo', hint: 'roleGrants.access.seeMedicalInfoHint' },
  payroll: { label: 'roleGrants.access.payroll', hint: 'roleGrants.access.payrollHint' },
  connectStripe: { label: 'roleGrants.access.connectStripe', hint: 'roleGrants.access.connectStripeHint' },
};

/** Decision 387's two presets. "Front desk": bookings and check-in, and
 * students. "Branch manager": everything at their branches. Neither manages
 * disciplines, which change the whole School (Decision 383), the School's
 * check-in rules (Decision 394), exports members' personal data (Decision 399),
 * freezes memberships (Decision 409), sees attendance statistics
 * (Decision 317 item 3: only staff the owner grants it), sees member files
 * (Decision 315 item 9), imports data (Decision 315 items 12, 13: only
 * staff the owner grants it), reads medical information (Decision 315
 * item 10), sees payroll (Decision 435 item 22: in no preset), or connects
 * Stripe (Decision 442 item 3: in no preset). */
export const PRESETS: Array<{ name: TranslationKey; access: StaffAccess }> = [
  {
    name: 'roleGrants.access.presetFrontDesk',
    access: { classes: false, bookings: true, students: true, cancelClasses: false, staffList: false, disciplines: false, checkInRules: false, exportStudents: false, freezeMemberships: false, attendanceStats: false, memberFiles: false, importData: false, seeMedicalInfo: false, payroll: false, connectStripe: false },
  },
  {
    name: 'roleGrants.access.presetBranchManager',
    access: { classes: true, bookings: true, students: true, cancelClasses: true, staffList: true, disciplines: false, checkInRules: false, exportStudents: false, freezeMemberships: false, attendanceStats: false, memberFiles: false, importData: false, seeMedicalInfo: false, payroll: false, connectStripe: false },
  },
];

const same = (a: StaffAccess, b: StaffAccess) => (Object.keys(LABELS) as AccessKey[]).every((k) => a[k] === b[k]);

/** The preset these switches match, or null for a custom set. */
export function presetOf(access: StaffAccess): TranslationKey | null {
  return PRESETS.find((p) => same(p.access, access))?.name ?? null;
}

/**
 * Decision 387 — the owner's Access page for one Branch Staff member: six
 * switches in groups, and the "Front desk" and "Branch manager" presets,
 * which only tick the switches (the owner can change any of them before
 * saving). Money and School settings are never here: they stay the owner's.
 *
 * Decision 449 item 7 — a coach's Access window: their one switch, "Manage
 * students" (off by default). Someone who is both Branch Staff and a coach
 * gets both, the coach's under its own heading.
 */
export function StaffAccessModal({
  schoolId,
  person,
  name,
  onDone,
  onClose,
}: {
  schoolId: string;
  person: StaffMember;
  name: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const save = useSetStaffAccess(schoolId);
  const saveCoach = useSetCoachAccess(schoolId);
  const [access, setAccess] = useState<StaffAccess | null>(person.access ?? null);
  const [coachAccess, setCoachAccess] = useState<CoachAccess | null>(person.coachAccess ?? null);
  const [error, setError] = useState<string | null>(null);
  const preset = access ? presetOf(access) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (access) await save.mutateAsync({ userId: person.userId, access });
      if (coachAccess && coachAccess.manageStudents !== person.coachAccess?.manageStudents) {
        await saveCoach.mutateAsync({ userId: person.userId, coachAccess });
      }
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={t('roleGrants.access.title', { name })} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <p>{t(access ? 'roleGrants.access.intro' : 'roleGrants.access.coachIntro')}</p>
        {error ? <ErrorBanner message={error} /> : null}
        {access ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <span>{t('roleGrants.access.presets')}</span>
            {PRESETS.map((p) => (
              <Button
                key={p.name}
                type="button"
                variant={preset === p.name ? undefined : 'secondary'}
                aria-pressed={preset === p.name}
                onClick={() => setAccess(p.access)}
              >
                {t(p.name)}
              </Button>
            ))}
            <span style={{ fontSize: 13, opacity: 0.75 }}>{preset ? t('roleGrants.access.usingPreset', { name: t(preset) }) : t('roleGrants.access.custom')}</span>
          </div>
        ) : null}
        {access && GROUPS.map((g) => (
          <fieldset key={g.heading} style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
            <legend style={{ fontWeight: 600, marginBottom: 4 }}>{t(g.heading)}</legend>
            {g.keys.map((k) => (
              <Switch
                key={k}
                id={`staff-access-${k}`}
                label={t(LABELS[k].label)}
                description={t(LABELS[k].hint)}
                checked={access[k]}
                onChange={(on) => setAccess((a) => (a ? { ...a, [k]: on } : a))}
              />
            ))}
          </fieldset>
        ))}
        {coachAccess ? (
          <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
            {access ? <legend style={{ fontWeight: 600, marginBottom: 4 }}>{t(ROLE_LABELS.INSTRUCTOR!)}</legend> : null}
            <Switch
              id="staff-access-coachManageStudents"
              label={t('roleGrants.access.coachManageStudents')}
              description={t('roleGrants.access.coachManageStudentsHint')}
              checked={coachAccess.manageStudents}
              onChange={(on) => setCoachAccess({ manageStudents: on })}
            />
          </fieldset>
        ) : null}
        <p style={{ fontSize: 13, opacity: 0.75 }}>{t('roleGrants.access.ownerOnly')}</p>
        <ModalActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={save.isPending || saveCoach.isPending}>
            {t('common.save')}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
