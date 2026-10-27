import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, PageHeader, SelectField, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth, useGradingSchoolId } from '../auth/AuthContext';
import { useStudentGuardians, useStudentLeavingSummary, useStudents, type StudentLeavingSummary } from '../students/studentQueries';
import { ReEnrolModal } from '../students/ReEnrolModal';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { useRanks } from '../ranks/rankQueries';
import { useSkills, type SkillResponse } from '../skills/skillQueries';
import { useLessons } from '../curriculum/curriculumQueries';
import { useInstructors } from '../instructors/instructorQueries';
import { useNextStudentBooking, type StudentBookingResponse } from '../bookings/bookingQueries';
import { useRevokeRoleGrant, useUserRoleGrants } from '../roleGrants/roleGrantQueries';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { flattenLadder, type Rung } from './ladder';
import { BeltChip } from './BeltChip';
import { HISTORY_TYPE_LABEL } from './historyLabels';
import {
  type Eligibility,
  type GradingToggle,
  type PromotionEvent,
  type StudentEligibility,
  type StudentFeeRequest,
  feeStatusOf,
  useChangeHistoryNote,
  useCycleSkill,
  useFeeRequestAction,
  usePromotionFeeSettings,
  useRankHistory,
  useSetBoardActive,
  useMyGrading,
  useStudentEligibility,
  useStudentFeeRequests,
} from './gradingQueries';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { Trans } from '../i18n/Trans';
import { DowngradeModal, EditNoteModal, GradeModal, LogClassModal, NoteLogModal, RankDateModal, VerifyRankModal, VoidEntryModal } from './GradingModals';
import { formatLocale } from '../i18n/format';
import { formatMoney } from '../lib/money';
import { DecideDialog } from './BoardPanels';
import { StudentMembershipsCard } from '../membershipPlans/StudentMembershipsCard';
import { formatHours } from './hours';

type Lesson = { id: string; title: string; skillIds: string[]; archivedAt?: string | null };

/** A date the API stores as the start of a local day, shown as that day.
 * Uses the browser's time zone, like every date on the portal today (see
 * lib/datetime.ts): a viewer in a different time zone from the student's
 * branch can see the neighbouring day. */
function dayOf(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Student grading panel (roadmap Phase 4, item 2): for one student, every
 * style at the School — current rank and since when, progress toward the next
 * rank from the grading engine, the skills for the next rank with sign-off and
 * linked lessons, and the rank history — with the grading actions: grade (or a
 * first rank), move down, correct the rank date, verify a self-declared rank
 * and void a history entry. The API enforces every rule; this screen shows them
 * up front.
 */
export function StudentGradingPage() {
  const { id } = useParams<{ id: string }>();
  const studentId = id ?? null;
  const schoolId = useGradingSchoolId();
  const navigate = useNavigate();
  const t = useT();
  const { claims } = useAuth();
  // The board passes the name along, for a student a coach's list doesn't
  // include.
  const passedName = (useLocation() as { state?: { name?: string } }).state?.name;
  const my = useMyGrading(schoolId);
  // Former students too, so their page still shows their name (Decision 341).
  const students = useStudents(schoolId, 'ALL');
  // Archived styles too: a student keeps their rank and history in one (Decision 310).
  const disciplines = useDisciplines(schoolId, { includeArchived: true });
  const eligibility = useStudentEligibility(studentId, schoolId);
  const lessons = useLessons(schoolId);
  const instructors = useInstructors(schoolId);
  const [showVoided, setShowVoided] = useState(false);
  const history = useRankHistory(studentId, schoolId, showVoided);
  const feeRequests = useStudentFeeRequests(studentId, schoolId);
  const feeSettings = usePromotionFeeSettings(schoolId);
  // v1.2 backend backlog — "Upcoming Booking" and "Revoke Enrollment", both
  // additions to this real page (the de facto Student Detail screen at
  // /students/:id — no separate mockup-matching page exists in this app; see
  // the backlog's own "Student Detail (new mockup, not yet built)" entry).
  const nextBooking = useNextStudentBooking(studentId, schoolId);
  const roleGrants = useUserRoleGrants(studentId);
  const revokeGrant = useRevokeRoleGrant();
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [reEnrolling, setReEnrolling] = useState(false);
  const enrolled = students.data?.items.find((s) => s.id === studentId)?.status === 'ACTIVE';
  // Decision 371 (Q4): who the student's Guardians are. Read for a current
  // student only (the API's own rule, like the profile read).
  const guardians = useStudentGuardians(schoolId, studentId, enrolled);

  const staffNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const i of instructors.data?.items ?? []) names.set(i.userId, `${i.firstName} ${i.surname}`.trim());
    return names;
  }, [instructors.data]);

  if (!schoolId || !studentId) return null;
  if (students.isLoading || disciplines.isLoading || eligibility.isLoading || my.isLoading) return <Spinner />;
  const loadError = students.error ?? disciplines.error ?? eligibility.error ?? my.error;
  if (loadError) {
    return <ErrorBanner message={loadError instanceof ApiError ? loadError.message : t('grading.student.loadFailed')} />;
  }

  const student = students.data?.items.find((s) => s.id === studentId);
  // A coach sees the styles they grade in (Decisions 181, 184).
  const ranks = eligibility.data?.items ?? [];
  const styles = (disciplines.data?.items ?? []).filter((d) => my.mayGradeStyle(d.id) && (!d.archivedAt || ranks.some((r) => r.disciplineId === d.id)));
  const studentName = student ? `${student.firstName} ${student.surname}`.trim() : passedName ?? t('grading.studentFallback');
  // A former student's grading history stays readable, but nothing can be
  // changed: the API refuses grading a student who isn't enrolled.
  const inactive = student?.status === 'INACTIVE';
  const performerName = (userId: string | null | undefined) =>
    !userId
      ? t('grading.student.formerInstructor')
      : userId === claims?.sub
        ? t('grading.student.you')
        : staffNames.get(userId) ?? t('grading.student.staffMember');
  // Revoke Enrollment is School Owner-only (matches the backend's own
  // assertSchoolOwner gate on DELETE /users/{userId}/role-grants/{id}) — a
  // coach visiting via /grading never sees this action.
  const activeStudentGrant = (roleGrants.data?.items ?? []).find(
    (g) => g.schoolId === schoolId && g.role === 'STUDENT' && !g.revokedAt,
  );

  return (
    <>
      <p style={{ margin: '0 0 8px' }}>
        {my.isOwner ? <Link to="/students">{t('grading.student.backToStudents')}</Link> : <Link to="/grading">{t('grading.student.backToBoard')}</Link>}
      </p>
      <PageHeader
        title={studentName}
        subtitle={inactive ? t('grading.student.inactiveSubtitle') : t('grading.student.subtitle')}
        actions={
          <>
            {inactive ? <Badge>{t('students.statusInactive')}</Badge> : null}
            {/* `StudentUpdate.dc.html` (v1.2 backend backlog) — any Staff
              * reaching this page (School Owner/Manager, Branch Staff, or
              * Instructor) may use it, matching the backend's own
              * assertStaffAtSchool gate — not Owner-only like Revoke
              * enrollment below, which the backend separately restricts via
              * assertSchoolOwner. A dedicated page (StudentUpdatePage.tsx at
              * /students/:id/edit), not a Modal — see that page's own header
              * comment for why. */}
            {student && !inactive ? (
              <Button variant="secondary" onClick={() => navigate(`/students/${studentId}/edit`)}>
                {t('grading.student.editProfile')}
              </Button>
            ) : null}
            {my.isOwner && inactive ? (
              <Button onClick={() => setReEnrolling(true)}>{t('students.reEnrol.button')}</Button>
            ) : null}
            {my.isOwner && activeStudentGrant ? (
              <Button variant="danger" onClick={() => setConfirmingRevoke(true)}>
                {t('grading.student.revokeEnrollment')}
              </Button>
            ) : null}
          </>
        }
      />

      {guardians.data && guardians.data.items.length > 0 ? (
        <p data-testid="student-guardians" style={{ margin: '0 0 16px' }}>
          {t('students.guardians', {
            count: guardians.data.items.length,
            names: guardians.data.items.map((g) => `${g.firstName} ${g.surname}`.trim()).join(', '),
          })}
        </p>
      ) : null}

      <div style={{ marginBottom: 24 }}>
        <Card>
          <h2 className="ultm8-page-header__title" style={{ fontSize: 15, marginBottom: 8 }}>
            {t('grading.student.upcomingBooking')}
          </h2>
          {nextBooking.isLoading ? (
            <Spinner />
          ) : nextBooking.error ? (
            <ErrorBanner message={nextBooking.error instanceof ApiError ? nextBooking.error.message : t('grading.student.bookingsLoadFailed')} />
          ) : (
            <UpcomingBooking next={nextBooking.data?.next ?? null} moreUpcoming={nextBooking.data?.moreUpcoming ?? 0} />
          )}
        </Card>
      </div>

      {/* Decision 348: memberships, selling at the desk, Friend Pass and
          cancelling a Subscription. Owner only, like the API. */}
      {my.isOwner ? <StudentMembershipsCard schoolId={schoolId} studentId={studentId} studentName={studentName} /> : null}

      {styles.length === 0 ? (
        <Card>
          {my.isOwner ? (
            <EmptyState title={t('grading.noStylesTitle')} description={t('grading.student.noStylesDescription')} />
          ) : (
            <EmptyState title={t('grading.noStylesToGradeTitle')} description={t('grading.noStylesToGradeDescription')} />
          )}
        </Card>
      ) : (
        styles.map((discipline) => (
          <DisciplineGradingCard
            key={discipline.id}
            studentId={studentId}
            schoolId={schoolId}
            discipline={discipline}
            studentRank={ranks.find((r) => r.disciplineId === discipline.id) ?? null}
            lessons={(lessons.data?.items ?? []) as Lesson[]}
            history={history.data?.items ?? []}
            historyLoading={history.isLoading}
            performerName={performerName}
            can={(toggle) => !inactive && my.can(discipline.id, toggle)}
            isOwner={my.isOwner}
            archived={!!discipline.archivedAt}
            firstName={student?.firstName || studentName}
            studentName={studentName}
            feeRequests={(feeRequests.data?.items ?? []).filter((r) => r.disciplineId === discipline.id)}
            feeCurrency={feeSettings.data?.currency ?? null}
          />
        ))
      )}
      <Checkbox label={t('grading.student.showVoided')} checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />

      {reEnrolling ? <ReEnrolModal schoolId={schoolId} studentId={studentId} studentName={studentName} onClose={() => setReEnrolling(false)} /> : null}

      {confirmingRevoke && activeStudentGrant ? (
        <ConfirmDeleteModal
          title={t('grading.student.revokeTitle', { name: studentName })}
          description={t('grading.student.revokeDescription')}
          confirmLabel={t('grading.student.revokeConfirm')}
          genericErrorMessage={t('grading.student.revokeFailed')}
          onConfirm={async () => {
            await revokeGrant.mutateAsync({ targetUserId: activeStudentGrant.userId, roleGrantId: activeStudentGrant.id });
            navigate('/students');
          }}
          onClose={() => setConfirmingRevoke(false)}
        >
          <RevokeLiveItems schoolId={schoolId} studentId={studentId} />
        </ConfirmDeleteModal>
      ) : null}
    </>
  );
}

/** What Revoke will also end, and the memberships it leaves running, so the
 * owner knows before confirming (Decision 343, S2). */
function RevokeLiveItems({ schoolId, studentId }: { schoolId: string; studentId: string }) {
  const t = useT();
  const summary = useStudentLeavingSummary(schoolId, studentId, true);
  if (summary.isLoading) return <p className="ultm8-field__hint">{t('grading.student.revokeLiveLoading')}</p>;
  if (summary.error || !summary.data) return <p className="ultm8-field__hint">{t('grading.student.revokeLiveFailed')}</p>;
  const { upcomingBookings, waitlistPlaces, memberships } = summary.data;
  if (upcomingBookings === 0 && waitlistPlaces === 0 && memberships.length === 0) {
    return <p>{t('grading.student.revokeNothingLive')}</p>;
  }
  return (
    <div data-testid="revoke-live-items">
      {upcomingBookings > 0 || waitlistPlaces > 0 ? (
        <>
          <p style={{ marginBottom: 4 }}>{t('grading.student.revokeWillCancel')}</p>
          <ul style={{ marginTop: 0 }}>
            {upcomingBookings > 0 ? <li>{t('grading.student.revokeBookings', { count: upcomingBookings })}</li> : null}
            {waitlistPlaces > 0 ? <li>{t('grading.student.revokeWaitlist', { count: waitlistPlaces })}</li> : null}
          </ul>
          {upcomingBookings > 0 ? <p className="ultm8-field__hint">{t('grading.student.revokeCreditNote')}</p> : null}
        </>
      ) : null}
      {memberships.length > 0 ? (
        <>
          <p style={{ marginBottom: 4 }}>{t('grading.student.revokeMembershipsTitle')}</p>
          <ul style={{ marginTop: 0 }}>
            {memberships.map((m) => (
              <li key={m.id}>{membershipLine(t, m)}</li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

function membershipLine(t: ReturnType<typeof useT>, m: StudentLeavingSummary['memberships'][number]): string {
  if (m.renews) return t('grading.student.revokeSubscriptionStops', { plan: m.planTitle });
  if (m.cancelAt) return t('grading.student.revokeSubscriptionEnds', { plan: m.planTitle, date: formatDay(m.cancelAt) });
  if (m.classesRemaining != null) return t('grading.student.revokeMembershipClasses', { plan: m.planTitle, count: m.classesRemaining });
  if (m.expiryDate) {
    return t('grading.student.revokeMembershipUntil', { plan: m.planTitle, date: formatDay(m.expiryDate) });
  }
  return m.planTitle;
}

/** The soonest upcoming booking whose class hasn't started, as the API picks
 * it across all of the student's bookings (Decision 341). */
function UpcomingBooking({ next, moreUpcoming }: { next: StudentBookingResponse | null; moreUpcoming: number }) {
  const t = useT();
  if (!next) {
    return <p className="ultm8-field__hint" style={{ margin: 0 }}>{t('grading.student.noUpcomingBooking')}</p>;
  }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <strong>{next.classTitle}</strong>
      <span className="ultm8-field__hint">{formatDay(next.classStartDate)}</span>
      {moreUpcoming > 0 ? <Badge>{t('grading.student.moreBookings', { count: moreUpcoming })}</Badge> : null}
    </div>
  );
}

type Dialog =
  | 'grade'
  | 'downgrade'
  | 'date'
  | 'verify'
  | 'log-class'
  | 'decide'
  | { promoteTo: string }
  | { voidEventId: string; summary: string }
  | { noteEventId: string; summary: string; note: string | null }
  | { logEventId: string; summary: string }
  | null;

function DisciplineGradingCard({
  studentId,
  schoolId,
  discipline,
  studentRank,
  lessons,
  history,
  historyLoading,
  performerName,
  can: canInStyle,
  isOwner,
  archived,
  firstName,
  studentName,
  feeRequests,
  feeCurrency,
}: {
  studentId: string;
  schoolId: string;
  discipline: DisciplineResponse;
  studentRank: StudentEligibility | null;
  lessons: Lesson[];
  history: PromotionEvent[];
  historyLoading: boolean;
  performerName: (userId: string | null | undefined) => string;
  /** What the caller may do in this style; actions they can't use are hidden. */
  can: (toggle: GradingToggle) => boolean;
  isOwner: boolean;
  /** The School no longer teaches this style (Decision 309): the rank and
   * history show, read-only but for voiding and notes (Decision 310). */
  archived: boolean;
  firstName: string;
  studentName: string;
  /** This style's promotion fee requests (Decisions 300, 307, 313). */
  feeRequests: StudentFeeRequest[];
  feeCurrency: string | null;
}) {
  const can = (toggle: GradingToggle) => (archived ? toggle === 'canVoidHistory' && canInStyle(toggle) : canInStyle(toggle));
  const ranks = useRanks(discipline.id);
  const skills = useSkills(discipline.id);
  const t = useT();
  const [dialog, setDialog] = useState<Dialog>(null);
  const changeNote = useChangeHistoryNote(studentId, schoolId);
  const [noteError, setNoteError] = useState<string | null>(null);
  // Who may grade this student in this style may edit or hide notes (Decision 192).
  const mayEditNotes = canInStyle('canPromote') || canInStyle('canDowngrade');

  const ladder = useMemo(() => flattenLadder(ranks.data?.items ?? []), [ranks.data]);
  const current = studentRank ? ladder.find((r) => r.id === studentRank.currentStripeId) ?? null : null;
  const eligibility = (studentRank?.eligibility ?? null) as Eligibility | null;
  const entries = studentRank ? history.filter((h) => h.studentRankId === studentRank.id) : [];
  const rungName = (rungId: string | null | undefined) => ladder.find((r) => r.id === rungId)?.name ?? t('grading.student.unknownRank');
  const fee = studentRank ? feeStatusOf(feeRequests, studentRank.currentStripeId) : null;
  // A promotion waiting for its fee is not graded again until it settles (Decision 300).
  const waiting = fee?.status === 'waiting';

  return (
    <section aria-label={discipline.name} style={{ marginBottom: 24 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h2 className="ultm8-page-header__title" style={{ fontSize: 18, marginBottom: 8 }}>
              {discipline.name} {archived ? <Badge>{t('disciplines.list.archived')}</Badge> : null}
            </h2>
            {archived ? <p className="ultm8-field__hint">{t('grading.student.archivedStyleNote')}</p> : null}
            {ranks.isLoading ? (
              <Spinner />
            ) : !studentRank ? (
              <p style={{ margin: 0 }}>{t('grading.student.noRankYet')}</p>
            ) : !current ? (
              <ErrorBanner message={t('grading.student.rankOffLadder')} />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <BeltChip rung={current} />
                <strong>{current.name}</strong>
                <span className="ultm8-field__hint">{t('grading.student.since', { date: formatDay(studentRank.dateOfCurrentRank) })}</span>
                {fee ? <FeeBadge status={fee.status} /> : null}
                {studentRank.verificationStatus === 'UNVERIFIED' ? <Badge variant="danger">{t('grading.student.selfDeclared')}</Badge> : null}
                {!archived && eligibility?.hasNext && eligibility.eligible && !waiting ? <Badge variant="success">{t('grading.student.readyToGrade')}</Badge> : null}
              </div>
            )}
          </div>
          {ladder.length > 0 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {studentRank?.verificationStatus === 'UNVERIFIED' && current && can('canVerifyRanks') ? (
                <Button onClick={() => setDialog('verify')}>{t('grading.student.verifyRank')}</Button>
              ) : null}
              {can('canPromote') && !waiting ? (
                <Button onClick={() => setDialog('grade')} disabled={!!studentRank && !current}>
                  {studentRank ? t('grading.student.grade') : t('grading.student.giveFirstRank')}
                </Button>
              ) : null}
              {current && current.index > 0 && can('canDowngrade') ? (
                <Button variant="secondary" onClick={() => setDialog('downgrade')}>
                  {t('grading.student.moveDown')}
                </Button>
              ) : null}
              {current && can('canAdjustProgress') ? (
                <Button variant="secondary" onClick={() => setDialog('date')}>
                  {t('grading.student.correctDate')}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {!ranks.isLoading && ladder.length === 0 ? (
          <p className="ultm8-field__hint">
            <Trans
              k="grading.student.noRanks"
              nodes={{ link: <Link to={`/disciplines/${discipline.id}`}>{t('grading.student.setUpLadder')}</Link> }}
            />
          </p>
        ) : null}

        {fee ? (
          <FeeBox
            fee={fee}
            firstName={firstName}
            currency={feeCurrency}
            isOwner={isOwner}
            canPromote={can('canPromote')}
            onDecide={() => setDialog('decide')}
            onPromote={() => setDialog({ promoteTo: fee.request.toRungId })}
          />
        ) : null}

        {current && eligibility && studentRank && !archived ? (
          <Progress
            eligibility={eligibility}
            breakdown={studentRank.progressBreakdown ?? null}
            hours={studentRank.hoursTrained}
            nextName={eligibility.hasNext ? rungName(eligibility.nextRungId) : null}
          />
        ) : null}

        {current && studentRank && can('canAdjustProgress') ? (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
            {eligibility?.hasNext && !eligibility.timeOnly ? (
              <Button variant="secondary" onClick={() => setDialog('log-class')}>
                {t('grading.student.logClass')}
              </Button>
            ) : null}
            <AttendingSwitch studentId={studentId} disciplineId={discipline.id} disciplineName={discipline.name} value={studentRank.boardActiveOverride ?? null} />
          </div>
        ) : null}

        {current && eligibility?.hasNext && !archived ? (
          <SkillsForNext
            studentId={studentId}
            eligibility={eligibility}
            statuses={studentRank?.skillStatuses ?? []}
            skills={skills.data?.items ?? []}
            lessons={lessons}
            canSignOff={can('canSignOffSkills')}
          />
        ) : null}

        {studentRank ? (
          <History
            entries={entries}
            loading={historyLoading}
            rungName={rungName}
            performerName={performerName}
            onVoid={can('canVoidHistory') ? (e, summary) => setDialog({ voidEventId: e.id, summary }) : undefined}
            onEditNote={mayEditNotes ? (e, summary) => setDialog({ noteEventId: e.id, summary, note: e.note ?? null }) : undefined}
            onToggleHidden={
              mayEditNotes
                ? async (e) => {
                    setNoteError(null);
                    try {
                      await changeNote.mutateAsync({ eventId: e.id, hidden: !e.noteHiddenAt });
                    } catch (err) {
                      setNoteError(err instanceof ApiError ? err.message : t('grading.student.noteChangeFailed'));
                    }
                  }
                : undefined
            }
            onNoteLog={isOwner ? (e, summary) => setDialog({ logEventId: e.id, summary }) : undefined}
            noteError={noteError}
          />
        ) : null}
      </Card>

      {dialog === 'grade' ? (
        <GradeModal studentId={studentId} discipline={discipline} ladder={ladder} current={current} eligibility={eligibility} onClose={() => setDialog(null)} />
      ) : null}
      {dialog && typeof dialog === 'object' && 'promoteTo' in dialog ? (
        <GradeModal
          studentId={studentId}
          discipline={discipline}
          ladder={ladder}
          current={current}
          eligibility={eligibility}
          initialTargetId={dialog.promoteTo}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'decide' && fee ? (
        <DecideDialog
          name={studentName}
          firstName={firstName}
          rank={fee.request.toRungName}
          from={current}
          to={ladder.find((r) => r.id === fee.request.toRungId) ?? null}
          canPromote={can('canPromote')}
          onPromote={() => setDialog({ promoteTo: fee.request.toRungId })}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === 'downgrade' && current ? (
        <DowngradeModal studentId={studentId} discipline={discipline} ladder={ladder} current={current} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'date' && studentRank ? (
        <RankDateModal studentId={studentId} discipline={discipline} currentDay={dayOf(studentRank.dateOfCurrentRank)} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'log-class' && current ? (
        <LogClassModal studentId={studentId} schoolId={schoolId} discipline={discipline} ladder={ladder} current={current} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'verify' && current ? (
        <VerifyRankModal studentId={studentId} discipline={discipline} ladder={ladder} current={current} onClose={() => setDialog(null)} />
      ) : null}
      {dialog && typeof dialog === 'object' && 'voidEventId' in dialog ? (
        <VoidEntryModal studentId={studentId} schoolId={schoolId} eventId={dialog.voidEventId} summary={dialog.summary} onClose={() => setDialog(null)} />
      ) : null}
      {dialog && typeof dialog === 'object' && 'noteEventId' in dialog ? (
        <EditNoteModal studentId={studentId} schoolId={schoolId} eventId={dialog.noteEventId} summary={dialog.summary} note={dialog.note} onClose={() => setDialog(null)} />
      ) : null}
      {dialog && typeof dialog === 'object' && 'logEventId' in dialog ? (
        <NoteLogModal studentId={studentId} schoolId={schoolId} eventId={dialog.logEventId} summary={dialog.summary} onClose={() => setDialog(null)} />
      ) : null}
    </section>
  );
}

/** "Currently attending" on the Grading Board, for this style only (Decisions
 * 152, 176): follow the student's membership, or set by hand. */
function AttendingSwitch({ studentId, disciplineId, disciplineName, value }: { studentId: string; disciplineId: string; disciplineName: string; value: boolean | null }) {
  const setActive = useSetBoardActive(disciplineId);
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const current = value === null ? 'AUTO' : value ? 'ACTIVE' : 'INACTIVE';
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <label htmlFor={`attending-${disciplineId}`} className="ultm8-field__label" style={{ margin: 0 }}>
        {t('grading.student.attending.label')}
      </label>
      <SelectField
        id={`attending-${disciplineId}`}
        aria-label={t('grading.student.attending.aria', { style: disciplineName })}
        value={current}
        disabled={setActive.isPending}
        onChange={async (e) => {
          setError(null);
          const v = e.target.value;
          try {
            await setActive.mutateAsync({ studentId, active: v === 'AUTO' ? null : v === 'ACTIVE' });
          } catch (err) {
            setError(err instanceof ApiError ? err.message : t('grading.student.attending.failed'));
          }
        }}
        options={[
          { value: 'AUTO', label: t('grading.student.attending.auto') },
          { value: 'ACTIVE', label: t('grading.student.attending.active') },
          { value: 'INACTIVE', label: t('grading.student.attending.inactive') },
        ]}
      />
      {error ? <span role="alert" className="ultm8-field__error">{error}</span> : null}
    </span>
  );
}

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      style={{ height: 8, borderRadius: 4, background: 'var(--color-neutral-200)', overflow: 'hidden', margin: '6px 0 12px' }}
    >
      <div style={{ width: `${percent}%`, height: '100%', background: percent >= 100 ? 'var(--color-success)' : 'var(--fill-accent)' }} />
    </div>
  );
}

type Breakdown = NonNullable<StudentEligibility['progressBreakdown']>;
type Hours = StudentEligibility['hoursTrained'];

/** Progress toward the next rank (Decisions 136, 149, 171), then the
 * Breakdown (Decision 301 item 4): one line per requirement grading uses,
 * each with its own tick, count, % and bar, and whether it is in the %
 * (classes; days on a time-only rank). Hours trained are a record only,
 * never part of grading (Decision 306). */
function Progress({ eligibility, breakdown, hours, nextName }: { eligibility: Eligibility; breakdown: Breakdown | null; hours: Hours; nextName: string | null }) {
  const t = useT();
  if (!eligibility.hasNext) {
    return (
      <>
        <p style={{ marginTop: 16 }}>
          {eligibility.dataError ? t('grading.student.progress.dataError') : t('grading.student.progress.top')}
        </p>
        <HoursTrained hours={hours} />
      </>
    );
  }
  const percent = eligibility.progressPercent ?? 0;
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 15, margin: '0 0 4px' }}>
        {t('grading.student.progress.toward', { name: nextName ?? '', percent })}
      </h3>
      <ProgressBar percent={percent} label={t('grading.student.progress.towardAria', { name: nextName ?? '' })} />
      {breakdown ? (
        <section aria-label={t('grading.student.progress.breakdown')}>
          <h4 style={{ fontSize: 14, margin: '0 0 6px' }}>{t('grading.student.progress.breakdown')}</h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            {breakdown.classes ? (
              <BreakdownRow
                ok={breakdown.classes.counted >= breakdown.classes.required}
                label={t('grading.student.progress.classesLabel')}
                value={t('grading.student.progress.xOfY', { done: breakdown.classes.counted, required: breakdown.classes.required })}
                percent={breakdown.classes.percent}
                inPercent
              >
                {breakdown.classes.byType.length > 0 ? (
                  <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {breakdown.classes.byType.map((row) => (
                      <li key={row.classType}>
                        {row.counted >= row.required ? '✓' : '○'}{' '}
                        {t('grading.student.progress.byType', { type: row.classType, counted: row.counted, required: row.required })}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </BreakdownRow>
            ) : null}
            <BreakdownRow
              ok={breakdown.days.elapsed >= breakdown.days.required}
              label={t('grading.student.progress.daysLabel')}
              value={
                breakdown.days.required > 0
                  ? t('grading.student.progress.xOfY', { done: breakdown.days.elapsed, required: breakdown.days.required })
                  : t('grading.student.progress.daysNoMinimum', { elapsed: breakdown.days.elapsed })
              }
              percent={breakdown.days.percent}
              inPercent={!breakdown.classes}
              noRequirement={breakdown.days.required === 0}
            />
            {breakdown.skills && breakdown.skills.required > 0 ? (
              <BreakdownRow
                ok={breakdown.skills.signedOff >= breakdown.skills.required}
                label={t('grading.student.progress.skillsLabel')}
                value={t('grading.student.progress.xOfY', { done: breakdown.skills.signedOff, required: breakdown.skills.required })}
                percent={breakdown.skills.percent}
                inPercent={false}
              />
            ) : null}
          </ul>
        </section>
      ) : null}
      <HoursTrained hours={hours} />
      <p className="ultm8-field__hint" style={{ margin: '8px 0 0' }}>
        {eligibility.timeOnly ? t('grading.student.progress.howDays') : t('grading.student.progress.howClasses')}
      </p>
    </div>
  );
}

function BreakdownRow({
  ok,
  label,
  value,
  percent,
  inPercent,
  noRequirement,
  children,
}: {
  ok: boolean;
  label: string;
  value: string;
  percent: number;
  inPercent: boolean;
  /** Nothing is required (days with no minimum): no "Needed too" note. */
  noRequirement?: boolean;
  children?: React.ReactNode;
}) {
  const t = useT();
  return (
    <li aria-label={`${label}: ${value}`}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span aria-hidden="true">{ok ? '✓' : '○'}</span>
        <strong style={{ fontWeight: 600 }}>{label}</strong>
        <span>{value}</span>
        <span className="ultm8-field__hint" style={{ marginLeft: 'auto' }}>
          {percent}%
        </span>
      </div>
      <div style={{ height: 4, borderRadius: 2, background: 'var(--color-neutral-200)', overflow: 'hidden', margin: '4px 0 2px' }}>
        <div style={{ width: `${percent}%`, height: '100%', background: ok ? 'var(--color-success)' : 'var(--fill-accent)' }} />
      </div>
      <span className="ultm8-field__hint">
        {inPercent ? t('grading.student.progress.inPercent') : noRequirement ? t('grading.student.progress.noMinimum') : t('grading.student.progress.notInPercent')}
      </span>
      {children}
    </li>
  );
}

/** Hours trained (Decisions 301, 306): logged, not graded. */
function HoursTrained({ hours }: { hours: Hours }) {
  const t = useT();
  return (
    <section aria-label={t('grading.student.hours.title')} style={{ borderTop: '1px solid var(--color-neutral-200)', marginTop: 12, paddingTop: 10 }}>
      <h4 style={{ fontSize: 14, margin: '0 0 2px' }}>{t('grading.student.hours.title')}</h4>
      <p style={{ margin: 0 }}>{t('grading.student.hours.atThisRank', { hours: formatHours(hours.sinceCurrentRankMinutes) })}</p>
      <p className="ultm8-field__hint" style={{ margin: 0 }}>
        {t('grading.student.hours.total', { hours: formatHours(hours.totalMinutes) })} · {t('grading.student.hours.recordOnly')}
      </p>
    </section>
  );
}

function FeeBadge({ status }: { status: 'waiting' | 'declined' | 'toDecide' }) {
  const t = useT();
  if (status === 'waiting') return <Badge variant="warning">{t('grading.board.fee.waiting')}</Badge>;
  if (status === 'declined') return <Badge variant="danger">{t('grading.board.fee.declined')}</Badge>;
  return <Badge variant="info">{t('grading.board.fee.toDecide')}</Badge>;
}

/** The promotion fee box (Decisions 300, 307, 313), as on the board's
 * panel: the owner waives or cancels; after a cancel (or waiving a declined
 * fee) a coach decides, and nothing promotes on its own. */
function FeeBox({
  fee,
  firstName,
  currency,
  isOwner,
  canPromote,
  onDecide,
  onPromote,
}: {
  fee: NonNullable<ReturnType<typeof feeStatusOf>>;
  firstName: string;
  currency: string | null;
  isOwner: boolean;
  canPromote: boolean;
  onDecide: () => void;
  onPromote: () => void;
}) {
  const t = useT();
  const waive = useFeeRequestAction('waive');
  const cancel = useFeeRequestAction('cancel');
  const dismiss = useFeeRequestAction('dismiss');
  const actionError = waive.error ?? cancel.error ?? dismiss.error;
  const { status, request } = fee;
  const amount = formatMoney(request.amountMinor, request.currency ?? currency);

  async function closeFee(action: 'waive' | 'cancel') {
    const mutation = action === 'waive' ? waive : cancel;
    await mutation.mutateAsync(request.id);
    // Waiving a waiting promotion applies it; anything else leaves it to a coach.
    if (!(action === 'waive' && status === 'waiting')) onDecide();
  }

  return (
    <section
      aria-label={t('grading.student.fee.aria')}
      style={{
        marginTop: 16,
        padding: 12,
        borderRadius: 10,
        background: status === 'declined' ? 'var(--bg-danger)' : status === 'toDecide' ? '#e5ecf6' : 'var(--bg-warning)',
      }}
    >
      <FeeBadge status={status} />
      <p style={{ margin: '8px 0 4px', fontWeight: 600 }}>
        {status === 'toDecide' ? t('grading.board.fee.noFeeFor', { rank: request.toRungName }) : t('grading.board.fee.amountFor', { amount, rank: request.toRungName })}
      </p>
      <p className="ultm8-field__hint" style={{ margin: 0 }}>
        {status === 'waiting'
          ? t('grading.board.fee.waitingText', { name: firstName, rank: request.toRungName })
          : status === 'declined'
            ? t('grading.board.fee.declinedText', { name: firstName, rank: request.toRungName })
            : t('grading.board.fee.toDecideText', { name: firstName })}
      </p>
      {actionError ? <ErrorBanner message={actionError instanceof ApiError ? actionError.message : t('common.tryAgain')} /> : null}
      <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
        {status !== 'toDecide' && isOwner ? (
          <>
            <Button variant="secondary" onClick={() => closeFee('waive')} loading={waive.isPending}>
              {t('grading.board.fee.waive')}
            </Button>
            <Button variant="secondary" onClick={() => closeFee('cancel')} loading={cancel.isPending}>
              {t('grading.board.fee.cancel')}
            </Button>
          </>
        ) : null}
        {status === 'toDecide' && canPromote ? (
          <>
            <Button onClick={onPromote}>{t('grading.board.fee.promoteTo', { rank: request.toRungName })}</Button>
            <Button variant="secondary" onClick={() => dismiss.mutate(request.id)} loading={dismiss.isPending}>
              {t('grading.board.fee.dontPromote')}
            </Button>
          </>
        ) : null}
      </div>
    </section>
  );
}

const STATUS_LABEL: Record<string, TranslationKey> = {
  NOT_STARTED: 'grading.student.skills.notStarted',
  LEARNING: 'grading.student.skills.learning',
  SIGNED_OFF: 'grading.student.skills.signedOff',
};
const NEXT_STATUS: Record<string, TranslationKey> = {
  NOT_STARTED: 'grading.student.skills.learning',
  LEARNING: 'grading.student.skills.signedOff',
  SIGNED_OFF: 'grading.student.skills.notStarted',
};

/** The skills for the next rank (Decision 127): required, or optional after a
 * time-only rank. Each cycles Not started → Learning → Signed off; lessons
 * linked to the skill are listed with it. */
function SkillsForNext({
  studentId,
  eligibility,
  statuses,
  skills,
  lessons,
  canSignOff,
}: {
  studentId: string;
  eligibility: Eligibility;
  statuses: Array<{ skillId: string; status: string }>;
  skills: SkillResponse[];
  lessons: Lesson[];
  canSignOff: boolean;
}) {
  const cycle = useCycleSkill(studentId);
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  const required = eligibility.requiredSkillIds ?? [];
  const optional = eligibility.optionalSkillIds ?? [];
  const ids = [...required, ...optional];
  if (ids.length === 0) return null;

  async function onCycle(skillId: string) {
    setError(null);
    try {
      await cycle.mutateAsync(skillId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('grading.student.skills.failed'));
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>{t('grading.student.skills.title')}</h3>
      {error ? <ErrorBanner message={error} /> : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        {ids.map((skillId) => {
          const skill = skills.find((s) => s.id === skillId);
          const status = statuses.find((s) => s.skillId === skillId)?.status ?? 'NOT_STARTED';
          // Archived lessons are hidden from students, so not offered here (C9).
          const linked = lessons.filter((l) => l.skillIds.includes(skillId) && !l.archivedAt);
          const name = skill?.name ?? t('grading.student.skills.fallbackName');
          return (
            <li key={skillId} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Button
                variant="secondary"
                onClick={() => onCycle(skillId)}
                disabled={cycle.isPending || !canSignOff}
                title={canSignOff ? undefined : t('grading.student.skills.cantSignOff')}
                aria-label={t('grading.student.skills.cycleAria', { name, status: t(STATUS_LABEL[status]), next: t(NEXT_STATUS[status]) })}
              >
                {t(STATUS_LABEL[status])}
              </Button>
              <span>
                {name}
                {optional.includes(skillId) ? <span className="ultm8-field__hint"> {t('grading.student.skills.optional')}</span> : null}
              </span>
              {status === 'SIGNED_OFF' ? <Badge variant="success">✓</Badge> : null}
              {linked.length > 0 ? (
                <span className="ultm8-field__hint">
                  {t('grading.student.skills.watch')}{' '}
                  {linked.map((l, i) => (
                    <React.Fragment key={l.id}>
                      {i > 0 ? ', ' : ''}
                      <Link to="/curriculum">{l.title}</Link>
                    </React.Fragment>
                  ))}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The rank history for this style (Decisions 129, 166): what changed, the
 * grading date, who did it, and the notes; voided entries only on request. */
function History({
  entries,
  loading,
  rungName,
  performerName,
  onVoid,
  onEditNote,
  onToggleHidden,
  onNoteLog,
  noteError,
}: {
  entries: PromotionEvent[];
  loading: boolean;
  rungName: (id: string | null | undefined) => string;
  performerName: (userId: string | null | undefined) => string;
  /** Absent when the caller may not void history in this style. */
  onVoid?: (entry: PromotionEvent, summary: string) => void;
  /** Absent when the caller may not edit or hide notes here (Decision 192). */
  onEditNote?: (entry: PromotionEvent, summary: string) => void;
  onToggleHidden?: (entry: PromotionEvent) => void;
  /** The owner's view of every change to a note. */
  onNoteLog?: (entry: PromotionEvent, summary: string) => void;
  noteError?: string | null;
}) {
  const t = useT();
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>{t('grading.student.history.title')}</h3>
      {noteError ? <ErrorBanner message={noteError} /> : null}
      {loading ? (
        <Spinner />
      ) : entries.length === 0 ? (
        <p className="ultm8-field__hint">{t('grading.student.history.empty')}</p>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          {entries.map((e) => {
            const labelKey = HISTORY_TYPE_LABEL[e.type];
            const label = labelKey ? t(labelKey) : e.type;
            const change =
              e.fromStripeTierId && e.fromStripeTierId !== e.toStripeTierId
                ? `${rungName(e.fromStripeTierId)} → ${rungName(e.toStripeTierId)}`
                : rungName(e.toStripeTierId);
            const summary = t('grading.student.history.summary', { label, change, date: formatDay(e.effectiveDate) });
            return (
              <li key={e.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8, opacity: e.voidedAt ? 0.6 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <span>
                    <strong>{label}</strong>{' '}
                    {t('grading.student.history.line', { change, date: formatDay(e.effectiveDate), name: performerName(e.performedById) })}
                    {e.voidedAt ? <Badge variant="danger">{t('grading.student.history.voided')}</Badge> : null}
                  </span>
                  {e.voidedAt || !onVoid ? null : (
                    <Button variant="secondary" onClick={() => onVoid(e, summary)} aria-label={t('grading.student.history.voidAria', { summary })}>
                      {t('grading.student.history.void')}
                    </Button>
                  )}
                </div>
                {e.acknowledgedWithoutSkillSignoff ? <div className="ultm8-field__hint">{t('grading.student.history.acknowledged')}</div> : null}
                {e.reason ? <div>{t('grading.student.history.reason', { reason: e.reason })}</div> : null}
                {e.systemNote ? <div className="ultm8-field__hint">{e.systemNote}</div> : null}
                {e.note ? (
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span>{t('grading.student.history.note', { note: e.note })}</span>
                    {e.noteEditedAt ? <Badge>{t('grading.student.history.edited', { date: formatDay(e.noteEditedAt) })}</Badge> : null}
                    {e.noteHiddenAt ? <Badge variant="danger">{t('grading.student.history.hiddenFromStudent')}</Badge> : null}
                  </div>
                ) : null}
                {!e.voidedAt && (onEditNote || onNoteLog) ? (
                  <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                    {onEditNote ? (
                      <Button variant="secondary" onClick={() => onEditNote(e, summary)} aria-label={e.note ? t('grading.student.history.editNoteAria', { summary }) : t('grading.student.history.addNoteAria', { summary })}
                      >
                        {e.note ? t('grading.student.history.editNote') : t('grading.student.history.addNote')}
                      </Button>
                    ) : null}
                    {onToggleHidden && e.note ? (
                      <Button variant="secondary" onClick={() => onToggleHidden(e)} aria-label={e.noteHiddenAt ? t('grading.student.history.showNoteAria', { summary }) : t('grading.student.history.hideNoteAria', { summary })}
                      >
                        {e.noteHiddenAt ? t('grading.student.history.showNote') : t('grading.student.history.hideNote')}
                      </Button>
                    ) : null}
                    {onNoteLog && (e.note || e.noteEditedAt) ? (
                      <Button variant="secondary" onClick={() => onNoteLog(e, summary)} aria-label={t('grading.student.history.noteChangesAria', { summary })}>
                        {t('grading.student.history.noteChanges')}
                      </Button>
                    ) : null}
                  </div>
                ) : null}
                {e.voidedAt ? (
                  <div className="ultm8-field__hint">
                    {t('grading.student.history.voidedBy', { date: formatDay(e.voidedAt), name: performerName(e.voidedById), reason: e.voidReason ?? '' })}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export type { Rung };
