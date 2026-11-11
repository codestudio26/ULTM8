import React from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { Avatar } from '../lib/Avatar';
import { formatCalendarDay } from '../membershipPlans/freezeQueries';
import { StudentCheckInCodeCard } from '../frontdesk/StudentCheckInCode';
import { useStudentCharges } from '../charges/chargeQueries';
import { BalanceLine } from '../charges/StudentChargesCard';
import { TemporaryPasscodeCard } from './StudentAccess';
import { StudentGuardiansCard } from './StudentGuardiansCard';
import { StudentTagsCard } from './StudentTagsCard';
import { ageOn } from './studentExport';
import { useStudentProfile, type StudentSummary } from './studentQueries';
import { PanelHeading, PanelRow } from './StudentPageLook';

/**
 * The student page's summary panel (DESIGN-BRIEF §8 "Student profile: the
 * full summary … with an Edit button"; DESIGN.md → "Student page: nothing
 * shown twice"): the photo, status and "Student since", Edit, the check-in
 * code, app access, Contact (with the Guardians), Personal, Training,
 * Account (the balance) and Tags. The name is in the page header, so it is
 * not repeated here. Everything comes from what the page already loaded;
 * each part keeps the permission checks it had as a card.
 */
export function StudentSummaryPanel({
  schoolId,
  studentId,
  student,
  studentName,
  inactive,
  isOwner,
  enrolled,
  mayEditProfile,
  maySeeDetails,
}: {
  schoolId: string;
  studentId: string;
  /** Missing for a student a coach's roster doesn't include. */
  student: StudentSummary | undefined;
  studentName: string;
  inactive: boolean;
  isOwner: boolean;
  enrolled: boolean;
  /** The Edit page's gate (Decision 448 item 11). */
  mayEditProfile: boolean;
  /** Who saw the member details card (Decision 315 items 4, 5). */
  maySeeDetails: boolean;
}) {
  const t = useT();
  const joined = student ? (student.joinedOn ? formatCalendarDay(student.joinedOn) : new Date(student.enrolledAt).toLocaleDateString(formatLocale())) : null;
  return (
    <div className="u8n-student-panel u8sp-panel">
      <div className="u8n-student-panel__who">
        <span className="u8sp-hero">
          <Avatar
            firstName={student?.firstName ?? studentName}
            surname={student?.surname ?? ''}
            photoUrl={student?.profilePhotoUrl}
            size={96}
            color="var(--u8n-avatar-bg)"
            textColor="var(--u8n-avatar-text)"
          />
        </span>
        <div className="u8sp-panel__who-text">
          {student ? (
            <div className="u8sp-panel__tags">
              <span className={'u8n-tag ' + (student.status === 'ACTIVE' ? 'u8n-tag--active' : 'u8n-tag--inactive')}>
                {student.status === 'ACTIVE' ? t('students.statusActive') : t('students.statusInactive')}
              </span>
              {student.visitor ? <span className="u8n-tag u8n-tag--visitor">{t('students.visitor.badge')}</span> : null}
              {student.frozen ? (
                <span className="u8n-tag u8n-tag--frozen" title={student.frozenUntil ? t('students.frozen.until', { date: formatCalendarDay(student.frozenUntil) }) : undefined}>
                  {t('students.frozen.badge')}
                </span>
              ) : null}
            </div>
          ) : null}
          {joined ? <p className="u8n-student-panel__since">{t('students.list.since', { date: joined })}</p> : null}
        </div>
        {/* `StudentUpdate.dc.html` (v1.2 backend backlog): the owner, and
          * Branch Staff with "Manage students" (Decision 448 item 11; not
          * coaches), matching the backend's gate. */}
        {student && !inactive && mayEditProfile ? (
          <Link to={`/students/${studentId}/edit`} className="u8sp-panel__edit" aria-label={t('students.list.editAria', { name: studentName })}>
            <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
              <path d="M4 20h4L19 9l-4-4L4 16z" />
            </svg>
            {t('students.list.edit')}
          </Link>
        ) : null}
      </div>

      {/* Decision 384: the personal check-in code typed at the front desk. */}
      {!inactive ? <StudentCheckInCodeCard schoolId={schoolId} studentId={studentId} /> : null}
      {/* Decision 403: a new temporary passcode while the account is unused. Owner only. */}
      {!inactive && isOwner ? <TemporaryPasscodeCard schoolId={schoolId} studentId={studentId} /> : null}

      <PanelHeading>{t('students.page.contact')}</PanelHeading>
      {maySeeDetails ? (
        <ProfileRows schoolId={schoolId} studentId={studentId} part="phone" />
      ) : null}
      {student ? <PanelRow label={t('students.signUps.email')}>{student.guardianManaged ? t('students.managedByGuardian') : student.email}</PanelRow> : null}
      {maySeeDetails ? <ProfileRows schoolId={schoolId} studentId={studentId} part="contacts" /> : null}
      {/* Decision 371 (Q4): who the student's Guardians are, read for a current
          student only; Decision 430: consent status, Remove / Add another Guardian. */}
      <StudentGuardiansCard schoolId={schoolId} studentId={studentId} studentName={studentName} enabled={enrolled} isOwner={isOwner} />
      {maySeeDetails ? <ProfileRows schoolId={schoolId} studentId={studentId} part="personal" /> : null}

      {student?.homeBranchName ? (
        <>
          <PanelHeading>{t('students.list.training')}</PanelHeading>
          <PanelRow label={t('students.list.homeBranch')}>{student.homeBranchName}</PanelRow>
        </>
      ) : null}

      <AccountRows schoolId={schoolId} studentId={studentId} />

      {/* Backlog 5.4: staff-only tags, plus "+ tag". */}
      {!inactive ? <StudentTagsCard schoolId={schoolId} studentId={studentId} /> : null}
    </div>
  );
}

/**
 * The member's own contacts and personal details, from the same profile the
 * Edit page reads (GET …/profile, one request for all three parts): `phone`;
 * `contacts`, their other contacts and emergency contact (Decision 315 item
 * 5); and `personal`, birthday with age, and gender.
 */
function ProfileRows({ schoolId, studentId, part }: { schoolId: string; studentId: string; part: 'phone' | 'contacts' | 'personal' }) {
  const t = useT();
  const profile = useStudentProfile(schoolId, studentId);
  if (profile.isLoading) return null;
  if (profile.error || !profile.data) {
    return part === 'phone' ? (
      <p className="u8sp-panel__note">{profile.error instanceof ApiError ? profile.error.message : t('students.details.loadFailed')}</p>
    ) : null;
  }
  const p = profile.data;
  const notGiven = <span className="u8sp-quiet">{t('students.details.notGiven')}</span>;
  const emergency = [p.emergencyContactName, p.emergencyContactRelationship ? `(${p.emergencyContactRelationship})` : null, p.emergencyContactPhone].filter(Boolean).join(' ');
  const dob = p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : null;
  const age = dob ? ageOn(dob) : '';
  if (part === 'phone') {
    return (
      <PanelRow label={t('students.signUps.phone')} testId="member-phone">
        {p.phone ? <a href={`tel:${p.phone}`}>{p.phone}</a> : notGiven}
      </PanelRow>
    );
  }
  if (part === 'contacts') {
    return (
      <>
      <PanelRow label={t('students.update.secondaryPhone')} testId="member-secondary-phone">
        {p.secondaryPhone ? <a href={`tel:${p.secondaryPhone}`}>{p.secondaryPhone}</a> : notGiven}
      </PanelRow>
      <PanelRow label={t('students.update.secondaryEmail')} testId="member-secondary-email">
        {p.secondaryEmail ? <a href={`mailto:${p.secondaryEmail}`}>{p.secondaryEmail}</a> : notGiven}
      </PanelRow>
      <PanelRow label={t('students.update.emergencyHeading')} testId="member-emergency">
        {emergency || notGiven}
      </PanelRow>
      </>
    );
  }
  return (
    <>
      <PanelHeading>{t('students.page.personal')}</PanelHeading>
      <PanelRow label={t('students.page.birthday')} testId="member-birthday">
        {dob ? (
          <>
            {formatCalendarDay(dob)}
            {age ? (
              <>
                <br />
                <span className="u8sp-quiet">{t('students.signUps.age', { age })}</span>
              </>
            ) : null}
          </>
        ) : (
          notGiven
        )}
      </PanelRow>
      <PanelRow label={t('students.signUps.gender')} testId="member-gender">
        {/* Decision 315 item 15: Female, Male or not given. */}
        {p.gender === 'FEMALE' ? t('frontDesk.signUp.female') : p.gender === 'MALE' ? t('frontDesk.signUp.male') : notGiven}
      </PanelRow>
    </>
  );
}

/** Account: the balance, for the owner and staff with a charges switch (the
 * API says who; for anyone else the section is left out). The same figures
 * the Payments card showed, from the same request. */
function AccountRows({ schoolId, studentId }: { schoolId: string; studentId: string }) {
  const t = useT();
  const charges = useStudentCharges(schoolId, studentId);
  if (!charges.data) return null;
  return (
    <>
      <PanelHeading>{t('students.page.account')}</PanelHeading>
      <PanelRow label={t('students.page.balance')}>
        <BalanceLine balances={charges.data.balances} />
      </PanelRow>
    </>
  );
}
