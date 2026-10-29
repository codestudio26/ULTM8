import React from 'react';
import { Badge, Button, Card, ErrorBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { useSchool } from '../schools/schoolQueries';
import { useMyStaffAccess } from '../roleGrants/roleGrantQueries';
import { useGiveVisitPass } from '../membershipPlans/membershipPlanQueries';
import type { StudentSummary } from './studentQueries';

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Decision 391: a student's Visitor status and "Give visit pass". A pass lets
 * a Visitor book and check in free for the School's visitor period; a second
 * one starts when the running one ends. Shown to the owner and to Branch Staff
 * with the students switch, the people the API lets give one.
 */
export function VisitorCard({ schoolId, student }: { schoolId: string; student: StudentSummary }) {
  const t = useT();
  const access = useMyStaffAccess(schoolId).data;
  const school = useSchool(schoolId).data;
  const give = useGiveVisitPass(schoolId, student.id);
  if (!access || !school) return null;
  if (!access.owner && !(access.branchStaff && access.access.students)) return null;

  const days = school.visitorPeriodDays ?? null;
  const endsAt = student.visitPassEndsAt ? new Date(student.visitPassEndsAt) : null;
  const running = endsAt !== null && endsAt.getTime() > Date.now();

  return (
    <div style={{ marginBottom: 24 }}>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <h2 className="ultm8-page-header__title" style={{ fontSize: 15, margin: 0 }}>
            {t('students.visitor.title')}
          </h2>
          {student.visitor ? <Badge variant="info">{t('students.visitor.badge')}</Badge> : null}
        </div>
        <p style={{ margin: '0 0 12px', color: 'var(--color-neutral-600)' }} data-testid="visitor-status">
          {!student.visitor
            ? t('students.visitor.notVisitor')
            : running
              ? t('students.visitor.passEnds', { date: formatDay(endsAt!.toISOString()) })
              : t('students.visitor.passEnded', { date: endsAt ? formatDay(endsAt.toISOString()) : '—' })}
        </p>
        {give.error ? <ErrorBanner message={give.error instanceof ApiError ? give.error.message : t('students.visitor.failed')} /> : null}
        {days === null ? (
          <p style={{ margin: 0 }}>{access.owner ? t('students.visitor.noPeriodOwner') : t('students.visitor.noPeriod')}</p>
        ) : (
          <Button variant="secondary" disabled={give.isPending} onClick={() => give.mutate()}>
            {running ? t('students.visitor.giveAnother') : t('students.visitor.give')}
          </Button>
        )}
      </Card>
    </div>
  );
}
