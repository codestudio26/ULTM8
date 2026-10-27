import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, SuccessBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { Avatar } from '../lib/Avatar';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { useRevokeRoleGrant, useUserRoleGrants } from '../roleGrants/roleGrantQueries';
import { useBranches } from '../branches/branchQueries';
import { WEEKDAY_ORDER, weekdayName } from '../timetable/timetableOccurrences';
import {
  fetchInstructorCertificationUrl,
  useAllTimetableSlots,
  useInstructor,
  useInstructorClasses,
  type InstructorClassResponse,
} from './instructorQueries';
import { GiveRoleBackModal, HandOverClassesModal, ResendPasscodeModal, RevokeBlockedModal } from './InstructorDetailActions';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

const PAST_SHOWN = 10;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Instructor Detail — v1.2 backend backlog. Real data only (no mockup
 * template to match): profile fields InstructorResponseDto already carries,
 * the real "Instructor Class" grid (GET /instructors/{id}/classes, with a
 * server-computed enrolledCount — see InstructorsService.findClassesForInstructor's
 * own header comment), and a Revoke Enrollment action for the underlying
 * INSTRUCTOR RoleGrant, using this app's existing ConfirmDeleteModal
 * confirmation pattern (not a browser confirm()).
 *
 * Decision 312 adds what the instructor filled in themselves (address,
 * activities, certification), their branch and weekly timetable slots, and
 * the two follow-ups to a revoke: handing their classes to someone else, and
 * giving the role back.
 *
 * Decision 331: the owner can resend the temporary passcode to someone who
 * hasn't signed in yet; revoking is refused while they still teach upcoming
 * classes or weekly slots (hand them over first); and address and
 * certification come back from the API only for the owner or the instructor.
 */
export function InstructorDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const instructorId = id ?? null;
  const schoolId = useOwnedSchoolId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: instructor, isLoading, error } = useInstructor(instructorId);
  const { data: classesData, isLoading: classesLoading, error: classesError } = useInstructorClasses(instructorId);
  const roleGrants = useUserRoleGrants(instructor?.userId ?? null);
  const revokeGrant = useRevokeRoleGrant();
  const { data: branchData } = useBranches(schoolId);
  const { data: slots } = useAllTimetableSlots(schoolId);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [showAllPast, setShowAllPast] = useState(false);
  const [handingOver, setHandingOver] = useState(false);
  const [givingRoleBack, setGivingRoleBack] = useState(false);
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [certError, setCertError] = useState<string | null>(null);

  if (!instructorId) return null;
  if (isLoading) return <Spinner />;
  if (error) {
    return <ErrorBanner message={error instanceof ApiError ? error.message : t('instructors.detail.loadFailed')} />;
  }
  if (!instructor) return null;

  // Upcoming soonest first, past most recent first (Decision 311, I14).
  const now = Date.now();
  const allClasses = classesData?.items ?? [];
  const upcoming = allClasses.filter((c) => new Date(c.endDate).getTime() >= now).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = allClasses.filter((c) => new Date(c.endDate).getTime() < now).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const activeGrants = (roleGrants.data?.items ?? []).filter(
    (g) => g.schoolId === schoolId && g.role === 'INSTRUCTOR' && !g.revokedAt,
  );
  const activeGrant = activeGrants[0];
  // The ones that keep making classes for them, Monday first.
  const mySlots = (slots ?? [])
    .filter((s) => s.instructorId === instructor.userId && s.status === 'ON' && !s.archivedAt)
    .sort((a, b) => WEEKDAY_ORDER.indexOf(a.weekday) - WEEKDAY_ORDER.indexOf(b.weekday) || a.startTime.localeCompare(b.startTime));
  const branchName = instructor.branchId
    ? branchData?.items.find((b) => b.id === instructor.branchId)?.name ?? instructor.branchId
    : t('instructors.allBranches');
  const name = `${instructor.firstName} ${instructor.surname}`.trim();
  // Their only Instructor role here and work still on their plate: the API
  // would refuse the revoke, so offer "Hand over classes" instead. With more
  // than one role, the API decides branch by branch.
  const revokeBlocked = activeGrants.length === 1 && (upcoming.length > 0 || mySlots.length > 0);

  async function openCertification() {
    setCertError(null);
    // Opened before the request so the browser doesn't treat it as a pop-up.
    const tab = window.open('', '_blank');
    try {
      const { url } = await fetchInstructorCertificationUrl(instructor!.id);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (err) {
      tab?.close();
      setCertError(err instanceof ApiError ? err.message : t('instructors.detail.certificationFailed'));
    }
  }

  return (
    <>
      <p style={{ margin: '0 0 8px' }}>
        <Link to="/instructors">{t('instructors.detail.back')}</Link>
      </p>
      <PageHeader
        title={name}
        subtitle={instructor.bio ?? undefined}
        actions={
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {schoolId && (upcoming.length > 0 || mySlots.length > 0) ? (
              <Button variant="secondary" onClick={() => setHandingOver(true)}>
                {t('instructors.detail.handOver')}
              </Button>
            ) : null}
            {schoolId && instructor.awaitingFirstLogin && instructor.status === 'ACTIVE' ? (
              <Button variant="secondary" onClick={() => setResending(true)}>
                {t('instructors.detail.resendPasscode')}
              </Button>
            ) : null}
            {activeGrant ? (
              <Button variant="danger" onClick={() => setConfirmingRevoke(true)}>
                {t('instructors.detail.revokeEnrollment')}
              </Button>
            ) : schoolId && instructor.status === 'REVOKED' ? (
              <Button variant="secondary" onClick={() => setGivingRoleBack(true)}>
                {t('instructors.detail.giveRoleBack')}
              </Button>
            ) : null}
          </div>
        }
      />
      {notice ? <SuccessBanner message={notice} /> : null}
      {certError ? <ErrorBanner message={certError} /> : null}

      <div style={{ marginBottom: 24 }}>
        <Card>
          <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
            <Avatar firstName={instructor.firstName} surname={instructor.surname} photoUrl={instructor.photoUrl} size={64} />
            <div style={{ display: 'grid', gap: 6 }}>
              <span>
                <strong>{t('instructors.detail.email')}</strong> {instructor.email}
              </span>
              <span>
                <strong>{t('instructors.detail.status')}</strong>{' '}
                <Badge variant={instructor.status === 'ACTIVE' ? 'success' : undefined}>
                  {instructor.status === 'ACTIVE' ? t('lib.instructorStatus.active') : t('lib.instructorStatus.revoked')}
                </Badge>{' '}
                {instructor.awaitingFirstLogin ? <Badge>{t('instructors.awaitingFirstLogin')}</Badge> : null}{' '}
                {instructor.archivedAt ? <Badge>{t('instructors.archived')}</Badge> : null}
              </span>
              <span>
                <strong>{t('instructors.detail.branch')}</strong> {branchName}
              </span>
              {instructor.phone ? (
                <span>
                  <strong>{t('instructors.detail.phone')}</strong> {instructor.phone}
                </span>
              ) : null}
              {instructor.yearsOfExperience != null ? (
                <span>
                  <strong>{t('instructors.detail.yearsOfExperience')}</strong> {instructor.yearsOfExperience}
                </span>
              ) : null}
              {instructor.specializations.length > 0 ? (
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{t('instructors.detail.specializations')}</strong>
                  {instructor.specializations.map((s, i) => (
                    <Badge key={`${s}-${i}`}>{s}</Badge>
                  ))}
                </span>
              ) : null}
              {/* Filled in by the instructor on their Complete Profile page. */}
              {instructor.activities.length > 0 ? (
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{t('instructors.detail.activities')}</strong>
                  {instructor.activities.map((a, i) => (
                    <Badge key={`${a}-${i}`}>{a}</Badge>
                  ))}
                </span>
              ) : null}
              {instructor.address ? (
                <span>
                  <strong>{t('instructors.detail.address')}</strong> {instructor.address}
                </span>
              ) : null}
              {instructor.certificationKey ? (
                <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{t('instructors.detail.certification')}</strong>
                  {instructor.certificationConsentedAt
                    ? t('instructors.detail.certificationConsented', { date: formatDate(instructor.certificationConsentedAt) })
                    : t('instructors.detail.certificationOnFile')}
                  <Button variant="secondary" onClick={openCertification}>
                    {t('instructors.detail.viewCertification')}
                  </Button>
                </span>
              ) : null}
            </div>
          </div>
        </Card>
      </div>

      <div>
        <h2 className="ultm8-page-header__title" style={{ fontSize: 18, marginBottom: 8 }}>
          {t('instructors.detail.upcomingHeading')}
        </h2>
        <Card>
          {classesLoading ? (
            <Spinner />
          ) : classesError ? (
            <ErrorBanner message={classesError instanceof ApiError ? classesError.message : t('instructors.detail.classesLoadFailed')} />
          ) : upcoming.length === 0 && past.length === 0 ? (
            <EmptyState title={t('instructors.detail.classesEmptyTitle')} description={t('instructors.detail.classesEmptyDescription')} />
          ) : upcoming.length === 0 ? (
            <EmptyState title={t('instructors.detail.upcomingEmptyTitle')} description={t('instructors.detail.upcomingEmptyDescription')} />
          ) : (
            <ClassList classes={upcoming} showBooked />
          )}
        </Card>
      </div>

      {mySlots.length > 0 ? (
        <div style={{ marginTop: 24 }}>
          <h2 className="ultm8-page-header__title" style={{ fontSize: 18, marginBottom: 8 }}>
            {t('instructors.detail.timetableHeading')}
          </h2>
          <Card>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
              {mySlots.map((s) => (
                <li key={s.id} style={{ padding: '10px 14px', borderRadius: 'var(--radius-md)', background: 'var(--surface-1)' }}>
                  <div style={{ fontWeight: 600 }}>{s.title}</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {weekdayName(s.weekday, formatLocale() ?? 'en', 'long')} {s.startTime}–{s.endTime}
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      {past.length > 0 ? (
        <div style={{ marginTop: 24 }}>
          <h2 className="ultm8-page-header__title" style={{ fontSize: 18, marginBottom: 8 }}>
            {t('instructors.detail.pastHeading')}
          </h2>
          <Card>
            <ClassList classes={showAllPast ? past : past.slice(0, PAST_SHOWN)} showBooked={false} />
            {past.length > PAST_SHOWN ? (
              <div style={{ marginTop: 12 }}>
                <Button variant="secondary" onClick={() => setShowAllPast((v) => !v)}>
                  {showAllPast ? t('instructors.detail.showFewerPast') : t('instructors.detail.showAllPast', { count: past.length })}
                </Button>
              </div>
            ) : null}
          </Card>
        </div>
      ) : null}

      {confirmingRevoke && activeGrant && revokeBlocked ? (
        <RevokeBlockedModal
          instructor={instructor}
          onHandOver={() => {
            setConfirmingRevoke(false);
            setHandingOver(true);
          }}
          onClose={() => setConfirmingRevoke(false)}
        />
      ) : null}

      {confirmingRevoke && activeGrant && !revokeBlocked ? (
        <ConfirmDeleteModal
          title={t('instructors.detail.revokeTitle', { name: `${instructor.firstName} ${instructor.surname}` })}
          description={t('instructors.detail.revokeDescription')}
          confirmLabel={t('instructors.detail.revokeConfirm')}
          genericErrorMessage={t('instructors.detail.revokeFailed')}
          onConfirm={async () => {
            await revokeGrant.mutateAsync({ targetUserId: activeGrant.userId, roleGrantId: activeGrant.id });
            // The roster's Status column and belts box change with it.
            await queryClient.invalidateQueries({ queryKey: ['instructors'] });
            await queryClient.invalidateQueries({ queryKey: ['instructor-belts'] });
            navigate('/instructors');
          }}
          onClose={() => setConfirmingRevoke(false)}
        />
      ) : null}

      {handingOver && schoolId ? (
        <HandOverClassesModal
          schoolId={schoolId}
          instructor={instructor}
          onDone={(message) => {
            setHandingOver(false);
            setNotice(message);
          }}
          onClose={() => setHandingOver(false)}
        />
      ) : null}

      {resending ? (
        <ResendPasscodeModal
          instructor={instructor}
          onDone={(message) => {
            setResending(false);
            setNotice(message);
          }}
          onClose={() => setResending(false)}
        />
      ) : null}

      {givingRoleBack && schoolId ? (
        <GiveRoleBackModal
          schoolId={schoolId}
          instructor={instructor}
          onDone={async () => {
            setGivingRoleBack(false);
            await queryClient.invalidateQueries({ queryKey: ['instructors'] });
            await queryClient.invalidateQueries({ queryKey: ['instructor-belts'] });
            setNotice(t('instructors.detail.giveRoleBackDone', { name }));
          }}
          onClose={() => setGivingRoleBack(false)}
        />
      ) : null}
    </>
  );
}

function ClassList({ classes, showBooked }: { classes: InstructorClassResponse[]; showBooked: boolean }) {
  const t = useT();
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
      {classes.map((c) => (
        <li
          key={c.id}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 12,
            padding: '10px 14px',
            borderRadius: 'var(--radius-md)',
            background: 'var(--surface-1)',
          }}
        >
          <div>
            <div style={{ fontWeight: 600 }}>{c.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatDate(c.startDate)}</div>
          </div>
          {/* The count is of upcoming bookings, so it means nothing once a class is over. */}
          {showBooked ? (
            <Badge variant="accent">
              {c.capacity != null
                ? t('instructors.detail.booked', { enrolled: c.enrolledCount, capacity: c.capacity })
                : t('instructors.detail.bookedNoCapacity', { enrolled: c.enrolledCount })}
            </Badge>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
