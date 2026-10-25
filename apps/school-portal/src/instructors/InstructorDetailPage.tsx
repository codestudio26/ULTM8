import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { Avatar } from '../lib/Avatar';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { useRevokeRoleGrant, useUserRoleGrants } from '../roleGrants/roleGrantQueries';
import { useInstructor, useInstructorClasses, type InstructorClassResponse } from './instructorQueries';
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
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [showAllPast, setShowAllPast] = useState(false);

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
  const activeGrant = (roleGrants.data?.items ?? []).find(
    (g) => g.schoolId === schoolId && g.role === 'INSTRUCTOR' && !g.revokedAt,
  );

  return (
    <>
      <p style={{ margin: '0 0 8px' }}>
        <Link to="/instructors">{t('instructors.detail.back')}</Link>
      </p>
      <PageHeader
        title={`${instructor.firstName} ${instructor.surname}`.trim()}
        subtitle={instructor.bio ?? undefined}
        actions={
          activeGrant ? (
            <Button variant="danger" onClick={() => setConfirmingRevoke(true)}>
              {t('instructors.detail.revokeEnrollment')}
            </Button>
          ) : undefined
        }
      />

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
                </Badge>
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

      {confirmingRevoke && activeGrant ? (
        <ConfirmDeleteModal
          title={t('instructors.detail.revokeTitle', { name: `${instructor.firstName} ${instructor.surname}` })}
          description={
            // Revoking doesn't move their classes (Decision 311, I5): say so first.
            upcoming.length > 0
              ? `${t('instructors.detail.revokeDescription')} ${t('instructors.detail.revokeUpcomingWarning', { count: upcoming.length })}`
              : t('instructors.detail.revokeDescription')
          }
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
