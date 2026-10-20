import React, { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { Avatar } from '../lib/Avatar';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { useRevokeRoleGrant, useUserRoleGrants } from '../roleGrants/roleGrantQueries';
import { useInstructor, useInstructorClasses } from './instructorQueries';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

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
  const { data: instructor, isLoading, error } = useInstructor(instructorId);
  const { data: classesData, isLoading: classesLoading, error: classesError } = useInstructorClasses(instructorId);
  const roleGrants = useUserRoleGrants(instructor?.userId ?? null);
  const revokeGrant = useRevokeRoleGrant();
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);

  if (!instructorId) return null;
  if (isLoading) return <Spinner />;
  if (error) {
    return <ErrorBanner message={error instanceof ApiError ? error.message : t('instructors.detail.loadFailed')} />;
  }
  if (!instructor) return null;

  const classes = classesData?.items ?? [];
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
          {t('instructors.detail.classesHeading')}
        </h2>
        <Card>
          {classesLoading ? (
            <Spinner />
          ) : classesError ? (
            <ErrorBanner message={classesError instanceof ApiError ? classesError.message : t('instructors.detail.classesLoadFailed')} />
          ) : classes.length === 0 ? (
            <EmptyState title={t('instructors.detail.classesEmptyTitle')} description={t('instructors.detail.classesEmptyDescription')} />
          ) : (
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
                  <Badge variant="accent">
                    {c.capacity != null
                      ? t('instructors.detail.booked', { enrolled: c.enrolledCount, capacity: c.capacity })
                      : t('instructors.detail.bookedNoCapacity', { enrolled: c.enrolledCount })}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {confirmingRevoke && activeGrant ? (
        <ConfirmDeleteModal
          title={t('instructors.detail.revokeTitle', { name: `${instructor.firstName} ${instructor.surname}` })}
          description={t('instructors.detail.revokeDescription')}
          confirmLabel={t('instructors.detail.revokeConfirm')}
          genericErrorMessage={t('instructors.detail.revokeFailed')}
          onConfirm={async () => {
            await revokeGrant.mutateAsync({ targetUserId: activeGrant.userId, roleGrantId: activeGrant.id });
            navigate('/instructors');
          }}
          onClose={() => setConfirmingRevoke(false)}
        />
      ) : null}
    </>
  );
}
