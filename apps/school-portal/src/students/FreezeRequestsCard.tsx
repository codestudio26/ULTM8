import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Card, ErrorBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { formatCalendarDay, useFreezeAction, useFreezeRequests } from '../membershipPlans/freezeQueries';

/**
 * Decision 404: freeze requests from members (or a child's Guardian) waiting
 * for the owner. Approve or decline here or on the student's page. Shown only
 * while there is one.
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
    <Card>
      <h2 className="ultm8-page-header__title" style={{ fontSize: 15, margin: '0 0 8px' }}>
        {t('students.freezeRequests.title')}
      </h2>
      {error ? <ErrorBanner message={error} /> : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }} data-testid="freeze-requests">
        {items.map((f) => (
          <li key={f.id} style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span>
              <Link to={`/students/${f.studentId}`}>{`${f.studentFirstName} ${f.studentSurname}`.trim()}</Link>{' '}
              {t('students.freezeRequests.row', { plan: f.planTitle, start: formatCalendarDay(f.startsAt), end: formatCalendarDay(f.endsAt) })}
            </span>
            <span style={{ display: 'inline-flex', gap: 8 }}>
              <Button variant="secondary" loading={action.isPending} onClick={() => decide(f.id, 'approve')}>
                {t('students.freezeRequests.approve')}
              </Button>
              <Button variant="secondary" loading={action.isPending} onClick={() => decide(f.id, 'decline')}>
                {t('students.freezeRequests.decline')}
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
