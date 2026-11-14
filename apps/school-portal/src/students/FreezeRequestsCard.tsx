import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, ErrorBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { formatCalendarDay, useFreezeAction, useFreezeRequests } from '../membershipPlans/freezeQueries';
import { BillingCard } from '../billing/BillingLook';
import './studentNotices.css';

/**
 * Decision 404: freeze requests from members (or a child's Guardian) waiting
 * for the owner, or for Branch Staff with "Can freeze memberships", who see
 * their branches' students' (Decision 409). Approve or decline here or on
 * the student's page. Shown only while there is one. In the new look
 * (Decision 453): a white card above the Students list, one line per request
 * with its two buttons as an equal pair (DESIGN.md → "Button pairs"):
 * Approve is the green main button, Decline the outlined one (Decision 462
 * item 23).
 */
export function FreezeRequestsCard({ schoolId }: { schoolId: string }) {
  const t = useT();
  const requests = useFreezeRequests(schoolId);
  const action = useFreezeAction(schoolId);
  const [error, setError] = useState<string | null>(null);
  const items = requests.data?.items ?? [];
  if (items.length === 0) return null;

  async function decide(freezeId: string, kind: 'approve' | 'decline') {
    setError(null);
    try {
      await action.mutateAsync({ freezeId, action: kind });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('students.freezeRequests.failed'));
    }
  }

  return (
    <div className="u8n-notice">
      <BillingCard title={t('students.freezeRequests.title')}>
        {error ? <ErrorBanner message={error} /> : null}
        <ul className="u8n-notice__rows" data-testid="freeze-requests">
          {items.map((f) => (
            <li key={f.id} className="u8n-notice__row">
              <span className="u8n-notice__text">
                <Link to={`/students/${f.studentId}`} className="u8n-notice__name">
                  {`${f.studentFirstName} ${f.studentSurname}`.trim()}
                </Link>{' '}
                {t('students.freezeRequests.row', { plan: f.planTitle, start: formatCalendarDay(f.startsAt), end: formatCalendarDay(f.endsAt) })}
              </span>
              <span className="u8n-notice__actions u8n-notice__actions--pair">
                <Button className="u8b-pill u8b-pill--row u8b-pill--primary" loading={action.isPending} onClick={() => decide(f.id, 'approve')}>
                  {t('students.freezeRequests.approve')}
                </Button>
                <Button variant="secondary" className="u8b-pill u8b-pill--row" loading={action.isPending} onClick={() => decide(f.id, 'decline')}>
                  {t('students.freezeRequests.decline')}
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </BillingCard>
    </div>
  );
}
